import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Public, Role, UserId, ViaApiKey } from './auth/auth.guard';
import { AuthService, UsageService } from './auth/auth.service';
import { isIsoDate, localDate } from './common/dates';
import { Profile } from './common/types';
import { EnergySampleInput, EnergyService } from './energy/energy.service';
import { WhoopService } from './integrations/whoop/whoop.service';
import { AnalyzeHints, MealPatch, MealsService } from './meals/meals.service';
import { ProfileService } from './profile/profile.service';
import { PlanService } from './plan/plan.service';
import { WorkoutInput, WorkoutsService } from './workouts/workouts.service';
import { CoachService } from './coach/coach.service';
import { FoodsService } from './foods/foods.service';
import { MotivationService } from './coach/motivation.service';
import { RemindersService } from './coach/reminders.service';
import { Workout } from './common/types';
import { AssistantService } from './assistant/assistant.service';
import { ShortcutService } from './energy/shortcut.service';
import { ScheduleService } from './schedule/schedule.service';
import { WaterService } from './water/water.service';
import { StepsService } from './steps/steps.service';
import { WeekService } from './week/week.service';
import { McpService } from './mcp/mcp.service';
import { OAuthError, OAuthService } from './mcp/oauth.service';
import { AccountService } from './account/account.service';
import { LegalPage, renderLegal } from './legal/legal';
import { GroupsService } from './groups/groups.service';
import { validateProfilePatch } from './profile/profile.service';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  ok() {
    return { ok: true };
  }
}

@Controller('meals')
export class MealsController {
  constructor(
    private readonly meals: MealsService,
    private readonly usage: UsageService,
  ) {}

  /** multipart/form-data: photo=<file>, mealName?, restaurant?, portion?, note?, eatenAt? */
  @Post('analyze')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async analyze(@UserId() userId: string, @Role() role: string, @UploadedFile() photo: Express.Multer.File, @Body() hints: AnalyzeHints) {
    if (!photo) throw new BadRequestException('photo file is required');
    await this.usage.consume(userId, role, 'analyze');
    return this.meals.analyzePhoto(userId, photo.buffer, photo.mimetype, hints);
  }

  @Post()
  create(@UserId() userId: string, @Body() body: any) {
    return this.meals.createManual(userId, body);
  }

  /** Typed or dictated description, e.g. "أكلت شاورما دجاج وعصير برتقال". */
  @Post('analyze-text')
  async analyzeText(@UserId() userId: string, @Role() role: string, @Body() body: { text: string; restaurant?: string; eatenAt?: string }) {
    await this.usage.consume(userId, role, 'analyze');
    return this.meals.analyzeText(userId, body?.text, { restaurant: body?.restaurant, eatenAt: body?.eatenAt });
  }

  @Get('favorites')
  favorites(@UserId() userId: string) {
    return this.meals.favorites(userId);
  }

  /** One tap: log a favourite again (no AI call, no quota). */
  @Post('favorites/log')
  logFavorite(@UserId() userId: string, @Body() body: { key: string; portionFactor?: number; eatenAt?: string }) {
    return this.meals.logFavorite(userId, body);
  }

  @Get()
  list(@UserId() userId: string, @Query('date') date: string) {
    if (!isIsoDate(date)) throw new BadRequestException('date=YYYY-MM-DD required');
    return this.meals.list(userId, date);
  }

  @Get(':id')
  get(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meals.getScored(userId, id);
  }

  @Patch(':id')
  async update(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() patch: MealPatch) {
    return this.meals.withScore(await this.meals.update(userId, id, patch));
  }

  @Post(':id/confirm')
  confirm(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meals.confirm(userId, id);
  }

  @Delete(':id')
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meals.remove(userId, id);
  }
}

@Controller()
export class EnergyController {
  constructor(
    private readonly energy: EnergyService,
    private readonly shortcut: ShortcutService,
  ) {}

  /** Personal token for the Apple Health iPhone Shortcut (rotate=1 makes a new one and disables the old). */
  @Get('energy/shortcut-token')
  shortcutToken(@UserId() userId: string, @Query('rotate') rotate?: string) {
    return this.shortcut.token(userId, rotate === '1');
  }

  @Get('energy/shortcut-status')
  shortcutStatus(@UserId() userId: string) {
    return this.shortcut.status(userId);
  }

  /** Called by the iPhone Shortcut: { active, basal, date? } + header X-Sync-Token (or ?token=). No login needed. */
  @Public()
  @Post('energy/shortcut')
  shortcutIngest(@Headers('x-sync-token') header: string, @Query('token') q: string, @Body() body: Record<string, unknown>) {
    return this.shortcut.ingest(header || q, body ?? {});
  }

  /** Devices push daily burn here (Apple Health from iOS, Health Connect from Android, Garmin/Fitbit bridges…). */
  @Post('energy/samples')
  ingest(@UserId() userId: string, @Body() body: { samples: EnergySampleInput[] }) {
    return this.energy.ingest(userId, body?.samples);
  }

  @Get('balance')
  balance(@UserId() userId: string, @Query('date') date?: string) {
    return this.energy.balance(userId, date);
  }
}

@Controller('profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  get(@UserId() userId: string) {
    return this.profiles.get(userId);
  }

  @Put()
  update(@UserId() userId: string, @Body() body: Partial<Profile>) {
    return this.profiles.update(userId, body);
  }
}

@Controller('integrations/whoop')
export class WhoopController {
  constructor(
    private readonly whoop: WhoopService,
    private readonly config: ConfigService,
    private readonly profiles: ProfileService,
  ) {}

  /** App calls this, then opens the returned URL in ASWebAuthenticationSession. */
  @Get('connect')
  connect(@UserId() userId: string, @Query('target') target?: string) {
    return { url: this.whoop.authorizeUrl(userId, target === 'web' ? 'web' : 'app') };
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    const web = `${(this.config.get<string>('PUBLIC_BASE_URL') ?? '').replace(/\/$/, '')}/app/`;
    const app =
      this.whoop.callbackTarget(state) === 'web' ? `${web}#whoop` : (this.config.get<string>('APP_CALLBACK_URL') ?? 'straineat://whoop');
    if (error || !code) return res.redirect(`${app}?status=error&reason=${encodeURIComponent(error ?? 'no_code')}`);
    try {
      await this.whoop.handleCallback(code, state);
      return res.redirect(`${app}?status=connected`);
    } catch (e: any) {
      return res.redirect(`${app}?status=error&reason=${encodeURIComponent(e?.message ?? 'failed')}`);
    }
  }

  /** Recovery, sleep and day strain for the last 7 days (needs read:recovery/read:sleep — reconnect once). */
  @Get('wellness')
  async wellness(@UserId() userId: string, @Query('date') date?: string, @Query('days') days?: string) {
    const p = await this.profiles.get(userId);
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDate(new Date(), p.timezone);
    return this.whoop.wellness(userId, d, Math.min(Math.max(Number(days) || 7, 1), 30));
  }

  @Get('status')
  status(@UserId() userId: string) {
    return this.whoop.status(userId);
  }

  @Post('sync')
  sync(@UserId() userId: string, @Query('from') from: string, @Query('to') to?: string) {
    if (!isIsoDate(from) || (to && !isIsoDate(to))) throw new BadRequestException('from/to must be YYYY-MM-DD');
    return this.whoop.sync(userId, from, to ?? from);
  }

  @Delete()
  disconnect(@UserId() userId: string) {
    return this.whoop.disconnect(userId);
  }
}

@Controller()
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  @Get('plan')
  plan(@UserId() userId: string) {
    return this.plans.plan(userId);
  }

  /** Live preview for onboarding — nothing is saved. */
  @Post('plan/preview')
  preview(@UserId() userId: string, @Body() body: Partial<Profile>) {
    return this.plans.plan(userId, validateProfilePatch(body));
  }

  @Get('weights')
  weights(@UserId() userId: string, @Query('days') days?: string) {
    return this.plans.weights(userId, Number(days) || 90);
  }

  @Post('weights')
  addWeight(@UserId() userId: string, @Body() body: { kg: number; date?: string }) {
    return this.plans.addWeight(userId, { kg: body?.kg, date: body?.date, source: 'manual' });
  }

  @Delete('weights/:date')
  deleteWeight(@UserId() userId: string, @Param('date') date: string) {
    return this.plans.deleteWeight(userId, date);
  }

  @Get('history')
  history(@UserId() userId: string, @Query('days') days?: string) {
    return this.plans.history(userId, Number(days) || 7);
  }
}

@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Get()
  day(@UserId() userId: string, @Query('date') date: string) {
    return this.workouts.forDay(userId, date);
  }

  /** Apple Health workouts from the iOS app (HKWorkout), Health Connect, or manual entries. */
  @Post()
  ingest(@UserId() userId: string, @Body() body: { source: Workout['source']; workouts: WorkoutInput[] }) {
    return this.workouts.ingest(userId, body?.source, body?.workouts);
  }

  @Delete(':id')
  remove(@UserId() userId: string, @Param('id') id: string) {
    return this.workouts.remove(userId, id);
  }
}

@Controller('coach')
export class CoachController {
  constructor(
    private readonly coach: CoachService,
    private readonly usage: UsageService,
  ) {}

  /** "What should I eat now?" (cached ~45 min per budget bucket; force=1 refreshes) */
  @Post('suggest')
  async suggest(@UserId() userId: string, @Role() role: string, @Query('force') force?: string) {
    await this.usage.consume(userId, role, 'coach');
    return this.coach.suggest(userId, { force: force === '1' });
  }

  @Get('weekly')
  async weekly(@UserId() userId: string, @Role() role: string, @Query('force') force?: string) {
    if (force === '1') await this.usage.consume(userId, role, 'coach');
    return this.coach.weekly(userId, { force: force === '1' });
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body);
  }

  /** Public with an invite code; the owner (API key) may also claim existing data with claimUserId. */
  @Public()
  @Post('register')
  register(@Body() body: any, @Role() role: 'owner' | 'user', @ViaApiKey() viaApiKey: boolean) {
    return this.auth.register(body, { role, viaApiKey });
  }

  @Get('me')
  me(@UserId() userId: string, @Role() role: string) {
    return this.auth.me(userId, role);
  }

  @Post('invites')
  invite(@UserId() userId: string, @Role() role: string) {
    return this.auth.createInvite(userId, role);
  }

  @Get('invites')
  invites(@UserId() userId: string, @Role() role: string) {
    return this.auth.listInvites(userId, role);
  }
}

@Controller('foods')
export class FoodsController {
  constructor(private readonly foods: FoodsService) {}

  @Get('barcode/:code')
  barcode(@Param('code') code: string) {
    return this.foods.byBarcode(code);
  }
}

@Controller('motivation')
export class MotivationController {
  constructor(private readonly motivation: MotivationService) {}

  @Get()
  summary(@UserId() userId: string) {
    return this.motivation.summary(userId);
  }
}

@Controller('push')
export class PushController {
  constructor(private readonly reminders: RemindersService) {}

  @Public()
  @Get('key')
  key() {
    return this.reminders.publicKey();
  }

  @Post('subscribe')
  subscribe(@UserId() userId: string, @Body() body: any) {
    return this.reminders.subscribe(userId, body);
  }

  @Post('unsubscribe')
  unsubscribe(@UserId() userId: string, @Body() body: { endpoint: string }) {
    return this.reminders.unsubscribe(userId, body?.endpoint);
  }

  @Post('test')
  test(@UserId() userId: string) {
    return this.reminders.test(userId);
  }
}

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly usage: UsageService,
  ) {}

  @Get('history')
  history(@UserId() userId: string) {
    return this.assistant.history(userId);
  }

  /** { message, screen? } → assistant reply (+ confirm cards for proposed actions) */
  @Post('chat')
  async chat(@UserId() userId: string, @Role() role: string, @Body() body: { message: string; screen?: string }) {
    await this.usage.consume(userId, role, 'chat');
    return this.assistant.chat(userId, body);
  }

  @Post('actions/:id/confirm')
  confirm(@UserId() userId: string, @Role() role: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.assistant.confirm(userId, id, () => this.usage.consume(userId, role, 'analyze'));
  }

  @Post('actions/:id/dismiss')
  dismiss(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.assistant.dismiss(userId, id);
  }

  @Delete('history')
  clear(@UserId() userId: string) {
    return this.assistant.clear(userId);
  }
}

/**
 * Connector for ChatGPT / Claude / Gemini (Model Context Protocol, streamable HTTP, stateless).
 * Trial: personal secret link /mcp/<token>; the user adds it as a custom connector.
 */
@Controller()
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Get('connector/token')
  token(@UserId() userId: string, @Query('rotate') rotate?: string) {
    return this.mcp.token(userId, rotate === '1');
  }

  /** Preferred: key in the Authorization header (Claude "Request headers"). */
  @Public()
  @Post('mcp')
  async postHeader(@Req() req: Request, @Res() res: Response) {
    await this.mcp.handle(req, res);
  }

  @Public()
  @Post('mcp/:token')
  async post(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    await this.mcp.handle(req, res, token);
  }

  @Public()
  @Get(['mcp', 'mcp/:token'])
  get(@Res() res: Response) {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST (stateless server)' }, id: null });
  }
}

@Controller('week')
export class WeekController {
  constructor(private readonly week: WeekService) {}

  /** This week (Mon–Sun) so far: calorie budget and protein / water / steps days. */
  @Get()
  summary(@UserId() userId: string) {
    return this.week.summary(userId);
  }
}

@Controller('steps')
export class StepsController {
  constructor(private readonly steps: StepsService) {}

  /** Steps for a day + goal (age-based, ramping up from the 7-day average). */
  @Get()
  day(@UserId() userId: string, @Query('date') date?: string) {
    return this.steps.day(userId, date);
  }

  @Get('history')
  history(@UserId() userId: string, @Query('days') days?: string) {
    return this.steps.history(userId, Number(days) || 7);
  }

  /** Apple Health daily step totals from the iOS app: { samples: [{ date, steps }] } */
  @Post('samples')
  ingest(@UserId() userId: string, @Body() body: { samples?: { date: string; steps: number }[] }) {
    return this.steps.ingest(userId, body?.samples ?? []);
  }
}

@Controller('water')
export class WaterController {
  constructor(private readonly water: WaterService) {}

  /** Today's water: target (sex + training + heat), intake (taps + drinks logged as meals + Apple Health), notes. */
  @Get()
  day(@UserId() userId: string, @Query('date') date?: string) {
    return this.water.day(userId, date);
  }

  @Get('history')
  history(@UserId() userId: string, @Query('days') days?: string) {
    return this.water.history(userId, Number(days) || 7);
  }

  /** { ml, at?, date? } — one tap */
  @Post()
  add(@UserId() userId: string, @Body() body: { ml?: number; at?: string; date?: string }) {
    return this.water.add(userId, body ?? {});
  }

  @Delete(':id')
  remove(@UserId() userId: string, @Param('id') id: string) {
    return this.water.remove(userId, id);
  }

  /** Apple Health daily totals from the iOS app: { samples: [{ date, ml }] } */
  @Post('samples')
  ingest(@UserId() userId: string, @Body() body: { samples?: { date: string; ml: number }[] }) {
    return this.water.ingest(userId, body?.samples ?? []);
  }
}

@Controller('schedule')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  /** The day's eating plan: slots (time, kcal target, status, what was eaten) + drinks. Edit via PUT /profile { mealSchedule }. */
  @Get()
  day(@UserId() userId: string, @Query('date') date?: string) {
    return this.schedule.day(userId, date);
  }

  /** Mark a slot as skipped today ({ slot, undo? }); returns the updated day. */
  @Post('skip')
  skip(@UserId() userId: string, @Body() body: { slot?: string; undo?: boolean; date?: string }) {
    return this.schedule.skip(userId, String(body?.slot || ''), !!body?.undo, body?.date);
  }
}

/** OAuth 2.1 for the MCP connector: discovery, registration, authorize (consent in the web app), token, revoke. */
@Controller()
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  private fail(res: Response, e: unknown) {
    if (e instanceof OAuthError) return res.status(e.status).set('Cache-Control', 'no-store').json({ error: e.error, error_description: e.description });
    throw e;
  }

  @Public()
  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp'])
  resourceMeta(@Req() req: Request) {
    return this.oauth.resourceMetadata(this.oauth.base(req));
  }

  @Public()
  @Get(['.well-known/oauth-authorization-server', '.well-known/openid-configuration'])
  serverMeta(@Req() req: Request) {
    return this.oauth.serverMetadata(this.oauth.base(req));
  }

  @Public()
  @Post(['oauth/register', 'register'])
  async register(@Body() body: any, @Res() res: Response) {
    try { res.status(201).set('Cache-Control', 'no-store').json(await this.oauth.register(body)); } catch (e) { this.fail(res, e); }
  }

  @Public()
  @Get(['oauth/authorize', 'authorize'])
  async authorize(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    try {
      const r = await this.oauth.startAuthorize(q);
      if (r.redirect) return res.redirect(302, r.redirect);
      return res.redirect(302, `${this.oauth.base(req)}/app/#oauth=${r.requestId}`);
    } catch (e) {
      if (!(e instanceof OAuthError)) throw e;
      const msg = String(e.description).replace(/[<>&"]/g, '');
      res.status(400).type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:24px;background:#111;color:#eee"><h3>StrainEat</h3><p>Can't start the connection: ${msg}.</p><p>Remove the connector in your AI app and add it again.</p></body>`);
    }
  }

  @Public()
  @Post(['oauth/token', 'token'])
  async token(@Body() body: any, @Headers('authorization') basic: string | undefined, @Res() res: Response) {
    try { res.status(200).set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).json(await this.oauth.token(body, basic)); } catch (e) { this.fail(res, e); }
  }

  @Public()
  @Post('oauth/revoke')
  async revoke(@Body() body: any, @Headers('authorization') basic: string | undefined) {
    await this.oauth.revokeToken(body, basic);
    return {};
  }

  // ---- signed-in web app ----
  @Get('oauth/request/:id')
  describe(@Param('id') id: string) {
    return this.oauth.describeRequest(id);
  }

  @Post('oauth/request/:id/approve')
  approve(@UserId() userId: string, @Param('id') id: string) {
    return this.oauth.decide(userId, id, true);
  }

  @Post('oauth/request/:id/deny')
  deny(@UserId() userId: string, @Param('id') id: string) {
    return this.oauth.decide(userId, id, false);
  }

  @Get('oauth/grants')
  grants(@UserId() userId: string) {
    return this.oauth.listGrants(userId);
  }

  @Delete('oauth/grants/:clientId')
  revokeGrant(@UserId() userId: string, @Param('clientId') clientId: string) {
    return this.oauth.revokeGrant(userId, clientId);
  }
}

@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService, private readonly auth: AuthService) {}

  /** Permanently deletes the signed-in account and all of its data. Body: { confirm: "DELETE" }. */
  @Delete()
  async remove(@UserId() userId: string, @Req() req: Request & { role?: 'owner' | 'user' }, @Body() body: { confirm?: string }) {
    const r = await this.account.deleteAccount(userId, req.role, body?.confirm);
    this.auth.forget(userId);
    return r;
  }
}

/** Public privacy policy / terms / support pages (App Store + connector directory listings link here). */
@Controller()
export class LegalController {
  constructor(private readonly config: ConfigService, private readonly oauth: OAuthService) {}

  private render(page: LegalPage, lang: string | undefined, accept: string | undefined, req: Request, res: Response) {
    const l = lang === 'ar' || lang === 'en' ? lang : /^ar/i.test(accept ?? '') ? 'ar' : 'en';
    const html = renderLegal(page, l, {
      name: this.config.get<string>('PUBLISHER_NAME')?.trim() || 'StrainEat',
      email: this.config.get<string>('CONTACT_EMAIL')?.trim() || 'SheenCafe@icloud.com',
      geminiTier: this.config.get<string>('GEMINI_TIER') === 'paid' ? 'paid' : 'free',
      base: this.oauth.base(req),
    });
    res.type('html').set('Cache-Control', 'public, max-age=300').send(html);
  }

  @Public() @Get('privacy')
  privacy(@Query('lang') lang: string, @Headers('accept-language') al: string, @Req() req: Request, @Res() res: Response) { this.render('privacy', lang, al, req, res); }

  @Public() @Get('terms')
  terms(@Query('lang') lang: string, @Headers('accept-language') al: string, @Req() req: Request, @Res() res: Response) { this.render('terms', lang, al, req, res); }

  @Public() @Get('support')
  support(@Query('lang') lang: string, @Headers('accept-language') al: string, @Req() req: Request, @Res() res: Response) { this.render('support', lang, al, req, res); }
}

/** Private challenge groups (invite-only leaderboards against each member's own targets). */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}
  @Get() list(@UserId() userId: string) { return this.groups.list(userId); }
  @Post() create(@UserId() userId: string, @Body() body: any) { return this.groups.create(userId, body); }
  @Get('invite/:code') preview(@Param('code') code: string) { return this.groups.preview(code); }
  @Post('join') join(@UserId() userId: string, @Body() body: any) { return this.groups.join(userId, body); }
  @Get(':id') info(@UserId() userId: string, @Param('id') id: string) { return this.groups.info(userId, id); }
  @Get(':id/board') board(@UserId() userId: string, @Param('id') id: string, @Query('tab') tab?: string, @Query('period') period?: string) { return this.groups.board(userId, id, tab, period); }
  @Get(':id/feed') feed(@UserId() userId: string, @Param('id') id: string) { return this.groups.feed(userId, id); }
  @Patch(':id/me') me(@UserId() userId: string, @Param('id') id: string, @Body() body: any) { return this.groups.updateMe(userId, id, body); }
  @Patch(':id') rename(@UserId() userId: string, @Param('id') id: string, @Body() body: any) { return this.groups.rename(userId, id, body?.name); }
  @Post(':id/code') rotate(@UserId() userId: string, @Param('id') id: string) { return this.groups.rotateCode(userId, id); }
  @Delete(':id/members/:member') remove(@UserId() userId: string, @Param('id') id: string, @Param('member') member: string) { return this.groups.removeMember(userId, id, member); }
  @Post(':id/leave') leave(@UserId() userId: string, @Param('id') id: string) { return this.groups.leave(userId, id); }
}
