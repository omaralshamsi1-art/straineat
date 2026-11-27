import { McpService } from './mcp/mcp.service';
import { OAuthService } from './mcp/oauth.service';
import { AccountService } from './account/account.service';
import { GroupsService } from './groups/groups.service';
import { WeekService } from './week/week.service';
import { StepsService } from './steps/steps.service';
import { WaterService } from './water/water.service';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AiContextInterceptor, AiUsageLog } from './usage/ai-usage';
import { CreditsService } from './iap/credits.service';
import { LocalizedErrorFilter } from './common/i18n-errors';
import { ANTHROPIC_CLIENT, anthropicFactory, NutritionAgentService } from './agent/nutrition-agent.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthService, UsageService } from './auth/auth.service';
import {
  EnergyController,
  HealthController,
  MealsController,
  PlanController,
  WorkoutsController,
  CoachController,
  AuthController,
  FoodsController,
  MotivationController,
  PushController,
  ProfileController,
  WhoopController,
  AssistantController,
  ScheduleController, WaterController, StepsController, WeekController, McpController, OAuthController, AccountController, LegalController, GroupsController, AdminController, IapController,
} from './controllers';
import { ScheduleService } from './schedule/schedule.service';
import { ShortcutService } from './energy/shortcut.service';
import { AssistantService } from './assistant/assistant.service';
import { EnergyService } from './energy/energy.service';
import { WhoopService } from './integrations/whoop/whoop.service';
import { MealsService } from './meals/meals.service';
import { ProfileService } from './profile/profile.service';
import { PlanService } from './plan/plan.service';
import { WorkoutsService } from './workouts/workouts.service';
import { CoachService } from './coach/coach.service';
import { FoodsService } from './foods/foods.service';
import { MotivationService } from './coach/motivation.service';
import { RemindersService } from './coach/reminders.service';
import { MemoryRepository } from './storage/memory.repository';
import { PostgresRepository } from './storage/postgres.repository';
import { REPOSITORY } from './storage/repository';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, AuthController, FoodsController, MotivationController, PushController, MealsController, PlanController, WorkoutsController, CoachController, EnergyController, ProfileController, WhoopController, AssistantController, ScheduleController, WaterController, StepsController, WeekController, McpController, OAuthController, AccountController, LegalController, GroupsController, AdminController, IapController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: LocalizedErrorFilter },
    { provide: APP_INTERCEPTOR, useClass: AiContextInterceptor },
    AiUsageLog,
    CreditsService,
    { provide: ANTHROPIC_CLIENT, useFactory: anthropicFactory, inject: [ConfigService] },
    {
      provide: REPOSITORY,
      useFactory: async (c: ConfigService) => {
        const url = c.get<string>('DATABASE_URL');
        return url ? PostgresRepository.fromUrl(url) : new MemoryRepository();
      },
      inject: [ConfigService],
    },
    NutritionAgentService,
    ProfileService,
    PlanService,
    WorkoutsService,
    CoachService,
    AuthService,
    UsageService,
    FoodsService,
    MotivationService,
    RemindersService,
    MealsService,
    EnergyService,
    WhoopService,
    AssistantService,
    ScheduleService,
    ShortcutService,
    WaterService,
    StepsService,
    WeekService,
    McpService,
    OAuthService,
    AccountService,
    GroupsService,
  ],
})
export class AppModule {}
