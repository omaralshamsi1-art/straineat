import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isIsoDate, localDate } from '../common/dates';
import { ramadanView } from '../coach/coach-math';
import { addDays, pickEnergy, PlanService } from '../plan/plan.service';
import { estimatedTdee, ProfileService } from '../profile/profile.service';
import { burnBonus } from '../insights/insights';
import { REPOSITORY, Repository } from '../storage/repository';
import { buildDay, rebalanceOpenSlots, defaultSchedule, usualMealTimes, ramadanSchedule, SLOT_LABEL, slotTargets, toMin } from './schedule';

const minuteIn = (iso: string, tz: string) =>
  toMin(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));

@Injectable()
export class ScheduleService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
    private readonly plans: PlanService,
  ) {}

  /** Today's eating plan: slots with times, kcal targets and what was logged; drinks listed apart. */
  async day(userId: string, date?: string, now = new Date()) {
    const p = await this.profiles.get(userId);
    const tz = p.timezone;
    const today = localDate(now, tz);
    const d = isIsoDate(date) ? date : today;
    const plan = await this.plans.plan(userId);
    const ram = ramadanView(p.ramadan, now, tz, plan.targetKcal);
    const history = await this.repo.listMealsRange(userId, addDays(today, -21), today);
    let schedule = (p as any).mealSchedule?.slots?.length ? (p as any).mealSchedule : defaultSchedule(p.mealsPerDay, usualMealTimes(history.filter((m) => m.date < today), tz));
    if (ram.active) schedule = ramadanSchedule(p.ramadan.suhoorTime, p.ramadan.iftarTime);
    const burn = pickEnergy(await this.repo.listEnergy(userId, d), p.preferredEnergySource);
    const bonus = burnBonus({ burnKcal: burn?.totalKcal, expectedKcal: plan.maintenanceKcal || estimatedTdee(p), partialDay: d === today, minuteOfDay: minuteIn(now.toISOString(), tz), deviceFactor: plan.deviceCalibration?.factor }).bonusKcal;
    const dayTarget = plan.targetKcal + bonus;
    const targets = slotTargets(schedule.slots, dayTarget, ram.split);
    const meals = d >= addDays(today, -21) && d <= today ? history.filter((m) => m.date === d) : await this.repo.listMeals(userId, d);
    const nowMin = d === today ? minuteIn(now.toISOString(), tz) : d < today ? 1440 : -1;
    const skip = await this.repo.getCache(userId, `schedule-skip:${d}`);
    const skipped: string[] = Array.isArray((skip?.payload as any)?.slots) ? (skip!.payload as any).slots : [];
    const view = buildDay(schedule.slots, targets, meals, nowMin, (m) => minuteIn(m.eatenAt, tz), skipped);
    if (d === today) {
      const eaten = meals.filter((m) => m.status === 'confirmed').reduce((a, m) => a + (m.final?.totals?.calories ?? 0), 0);
      rebalanceOpenSlots(view.slots, dayTarget, eaten);
    }
    const lang = p.language === 'ar' ? 'ar' : 'en';
    return {
      date: d,
      custom: !!schedule.custom && !ram.active,
      ramadan: ram.active,
      fasting: ram.fasting,
      targetKcal: dayTarget,
      burnBonusKcal: bonus,
      ...view,
      slots: view.slots.map((s) => ({ ...s, label: SLOT_LABEL[s.id][lang], label_en: SLOT_LABEL[s.id].en, label_ar: SLOT_LABEL[s.id].ar })),
    };
  }

  /** Mark a planned slot as intentionally skipped today (or undo). Skipped slots get no reminders. */
  async skip(userId: string, slot: string, undo = false, date?: string, now = new Date()) {
    const p = await this.profiles.get(userId);
    const d = isIsoDate(date) ? date : localDate(now, p.timezone);
    if (!Object.prototype.hasOwnProperty.call(SLOT_LABEL, slot)) throw new BadRequestException('Unknown slot');
    const key = `schedule-skip:${d}`;
    const cur = await this.repo.getCache(userId, key);
    const set = new Set<string>(Array.isArray((cur?.payload as any)?.slots) ? (cur!.payload as any).slots : []);
    if (undo) set.delete(slot); else set.add(slot);
    await this.repo.setCache({ userId, key, payload: { slots: [...set] }, createdAt: now.toISOString() });
    return this.day(userId, d, now);
  }
}
