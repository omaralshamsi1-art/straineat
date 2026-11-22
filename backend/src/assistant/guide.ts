/**
 * Everything the in-app assistant knows about how StrainEat works.
 * Keep this in sync with the UI (web public/index.html and the iOS views).
 */
export const APP_GUIDE = `
# StrainEat — how the app works (use this to explain the app to users)

StrainEat is a nutrition tracker: snap or describe a meal, an AI estimates calories and macros (looking up restaurant
nutrition when a restaurant is named), the user reviews/edits, then confirms. Intake is compared with a daily calorie
target from the user's plan, and with calories burned (Apple Health, WHOOP or manual entry).
Units: calories are kcal; macros in grams (g); weight in kg.
Bottom navigation — web app: Today · Progress · Snap (camera button in the middle) · My plan · Settings.
iPhone app: Today · Progress · Log meal · Plan (the iPhone "Plan" tab also holds the settings: account, location, Devices & apps
— Apple Health and WHOOP —, Ramadan & fasting, reminders, Language). On both, the orange ✦ button opens this assistant.
The app is in English by default; Settings → Language switches to Arabic (the AI follows the chosen language).

## Today
- Top: three rings — EATEN (% of today's calorie target eaten; red when over), LEFT (kcal left = target − confirmed
  meals) and BURN (kcal burned so far today; the ring fills toward the expected full-day burn). Tap a ring for details.
- Under the rings: a status line, then two cards — "Nutrition monitor" (calories, protein, carbs, fat, fibre, sodium
  vs target: "within range" or which need attention) and "Energy" (burn − intake so far: +deficit / −surplus). Tapping opens
  a detail page with a 7-day chart and a tile per metric with its range. Drafts (analysed but not confirmed) do NOT
  count until confirmed. Burn comes from WHOOP / Apple Health / manual entry.
- Today's eating schedule: each planned meal/snack with its time, a kcal target and status (Done / Now / Upcoming /
  Not logged). Drinks (coffee, tea, juice…) are listed apart: they count in calories but never as a meal. "Edit times"
  opens Settings → Meal schedule (Automatic from meals per day and usual times, or My times). In Ramadan it becomes
  iftar / evening / suhoor.
- Ramadan card (appears during Ramadan or when fasting mode is on): suhoor/iftar times and how the day's target is split.
- Tips and the weekly challenge.
- "What should I eat now?": 6 AI ideas that fit the calories and protein left — 2 home recipes (tap for ingredients
  and method), 2 from healthy restaurants and 2 smart picks from fast-food chains near the user (based on the emirate and
  area saved in Settings → "Your location for suggestions"). "Log it" adds one to today; "More options" brings
  different restaurants and recipes.
- Your activity: workouts synced from Apple Health/WHOOP or added manually, with calories burned.
- Today's meals: every meal with its calories (the number + "kcal" on each row is that meal's calories) and a score.
  Tap a meal to open it, edit it, or delete it.

## Snap / Log a meal (camera button on web, "Log meal" tab on iPhone)
Four modes at the top:
1. Photo — take a photo or pick from the library; optional hints (meal name, restaurant, portion e.g. "half", note e.g.
   "no sauce") make estimates much more accurate. Press "Calculate nutrition". Takes up to a minute.
2. Type / voice — describe the meal ("chicken shawarma sandwich from Al Mallah and a small orange juice"); tap the mic to
   dictate. Optional restaurant field.
3. Barcode — scan with the camera or type the number (Open Food Facts database) for packaged food.
4. Favourites — meals you logged before; one tap logs them again instantly (no AI wait, no daily quota).
After analysis the Review screen opens.

## Review (after analysis)
- Each ingredient with its grams and calories — tap to edit the amount or remove it; totals update.
- "Agent assumptions" — what the AI assumed (e.g. portion, cooking oil); correct them if wrong.
- Warnings (e.g. high sodium for someone with hypertension), sources (restaurant pages used), a meal score with reasons
  and smarter swaps.
- Type: Meal / Snack / Drink (guessed automatically; change it if wrong — it decides which schedule slot it fills).
- Press Confirm to add it to the day. Unconfirmed meals stay as drafts and are not counted.

## Progress
- Weight: log today's weight (or it syncs from Apple Health); chart of the trend and change since start.
- Badges and streaks (days logged in a row, days on target).
- Weekly report: AI review of the week — what worked and what to improve (Refresh to regenerate).
- Last 7 days: intake vs target per day.

## My plan
- Daily target (kcal) with protein / carbs / fat grams, fiber, estimated daily burn (TDEE), how it was calculated
  (formula, or measured burn from the watch once there are enough days), activity level, difference from burn,
  expected weekly weight change, BMI.
- "Edit goal & plan" re-opens the step-by-step setup: sex, birth date, height, weight, target weight, pace
  (relaxed / moderate / fast), activity level, diet style (normal, vegetarian, vegan, keto, low-carb, Mediterranean,
  paleo, light), health conditions (hypertension, high cholesterol, obesity, kidney, heart, thyroid, diabetes),
  meals per day, Ramadan fasting.
- Kidney, heart, diabetes and thyroid conditions, pregnancy/breastfeeding or an eating-disorder history make the plan
  "supervised": gentler targets and a reminder to follow the user's clinician.
- Manual burn entry: for users without WHOOP/Apple Health — enter active and basal kcal from the Health app.

## Settings
- Account (name, email, role), invite users (owner), meal schedule + reminders (10 min before each meal/snack and
  again if a meal isn't logged an hour later; on iPhone turn on "Meal reminders" and allow notifications; on the web
  add the app to the Home Screen and enable reminders), Ramadan & fasting mode (on/off/auto, suhoor and iftar times), WHOOP connect/disconnect,
  Apple Health (iPhone app only: syncs burned energy, workouts and weight), Appearance (Auto / Light / Dark — Auto
  follows the phone), Language (English / العربية), sign out.

## WHOOP recovery & sleep
With WHOOP connected, Today shows a "Recovery & sleep" card (recovery %, sleep time vs need, day strain); tapping it
opens details: HRV, resting HR, SpO2, skin temp, respiratory rate, sleep stages, performance and efficiency, with a
7-day recovery chart. Older connections must tap "Reconnect WHOOP" once to allow recovery and sleep. Low recovery or
short sleep → suggest easy, protein-rich, hydrating food and warn about cravings; no extra restriction.

## Apple Health on the website
A website can't read Apple Health. Settings → Burn source → Apple Health offers an iPhone Shortcut: copy the personal
sync link, build the Shortcut (Find Health Samples: Active Energy / Resting Energy, start date today → Calculate
Statistics: Sum → Get Contents of URL, POST, JSON body active + basal) and add Time of Day automations (e.g. 12:00,
18:00, 22:00, Run Immediately). "Check data received" shows the last time it arrived. The iPhone app syncs Apple
Health by itself (pull down to refresh).

## Common questions (answer like this)
- Water: plain water, sparkling water, black coffee, plain tea and zero-calorie drinks have ~0 kcal — no need to log
  them. Drinks WITH calories must be logged as a meal: juices, smoothies, soft drinks, milk, karak, coffee with milk or
  sugar (latte, cappuccino, Spanish latte), protein shakes, energy drinks.
- Why doesn't my meal count? It is still a draft — open it and Confirm.
- Burned calories differ from my watch: the daily target is stable and comes from the plan; burn is shown alongside.
  Once enough watch days exist the plan calibrates to measured burn.
- Accuracy: add the restaurant name and portion; edit ingredients on the Review screen.
- Daily AI limits for regular users: 20 meal analyses, 12 coach requests, 30 assistant messages; favourites are
  unlimited.

- Medicines & vitamins (Settings/Plan): add a name, optional dose and 1–6 daily times; the app sends a notification at each time (needs notifications enabled). Reminders only — it never gives dosing advice.
`;
