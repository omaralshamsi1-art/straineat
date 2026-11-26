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
- Ramadan / fasting card (appears during Ramadan, when fasting mode is on, or on the user's chosen fasting days): suhoor/iftar
  times and how the day's target is split.
- Steps (👣 in the Body monitor and the Activity card): from WHOOP (cycle step count, synced with WHOOP), Apple Health (iPhone
  app: merged total and each source — iPhone, Watch, Google Health/Fitbit — the highest is used) and the Shortcut "steps" field.
  Each source keeps its own count for the day and the day shows the HIGHEST, with its source and time. Goal: 9,000 under 60 / 7,000 at 60+ (Paluch 2022: benefit levels off around 8–10k under 60
  and 6–8k at 60+), ramping up from the user's 7-day average by +1,000 (min 4,000). Use get_steps.
- Water (💧 monitor on Today): daily drinking target in ml = 2.2 L women / 3.0 L men from drinks (NASEM adequate intake;
  ~80% of total water comes from drinks), 2.3 L pregnant, 3.1 L breastfeeding, +500 ml per hour of training (max +1.5 L),
  +750 ml if "I work or train in the heat" is on (Settings → Reminders/Water). Kidney or heart conditions: no target, tracking
  only, follow the doctor's fluid advice. Intake = quick taps (+250 / +500 / custom, undo) + drinks logged as meals (coffee,
  tea, juice, laban count) + water from Apple Health (iPhone app). Push nudges at 11:00/14:00/17:00/20:00 only when ≥500 ml
  behind the expected pace (none while fasting; on fasting days one nudge 2 h after iftar). Warnings when >1.5 L logged
  within an hour or >6 L a day (low blood sodium risk). Use get_water.
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
  (relaxed / moderate / fast / intense, or "by a date": the user picks a target date and the plan works out the weekly
  pace), activity level, diet style (normal, vegetarian, vegan, keto, low-carb, Mediterranean,
  paleo, light), health conditions (hypertension, high cholesterol, obesity, kidney, heart, thyroid, diabetes),
  meals per day, Ramadan fasting.
- Intense pace (~1% of body weight a week): only with BMI ≥ 25, age 18–64 and no supervised condition; capped under
  ~1.36 kg (3 lb) a week (gallstone risk, NIDDK), never under the calorie floor; protein raised to 2.2 g/kg; the plan
  lists advice (resistance training, hunger/fatigue, keep it to 8–12 weeks then maintain, warning signs to see a doctor).
  A target date that needs more than the safe maximum is planned at the safe maximum and shows the realistic date.
  When a user asks to lose weight fast, explain these trade-offs honestly and offer the intense pace or a target date.
- Burn bonus: on a day the watch shows a bigger burn than expected, half the extra is added to the food target; once
  the watch is calibrated against the user's own weight trend (intake − weight change, ~3 weeks), its bias is corrected
  first and 75% is given back. The plan shows the watch's accuracy for that user.
- Kidney, heart, diabetes and thyroid conditions, pregnancy/breastfeeding or an eating-disorder history make the plan
  "supervised": gentler targets and a reminder to follow the user's clinician.
- Fitbit (incl. Fitbit Air): no direct link; it arrives through Apple Health. In the Google Health app (iPhone): Connections → Apps and
  services → Apple Health → Get started, turn on active calories, exercise, sleep and weight; StrainEat then reads it like any Apple Health
  data (iPhone app sync, or the Shortcut on the web). Fitbit doesn't send resting energy, so StrainEat adds it from the BMR formula.
- Manual burn entry: for users without WHOOP/Apple Health — enter active and basal kcal from the Health app.

## Settings
- Account (name, email, role), invite users (owner), meal schedule + reminders (10 min before each meal/snack and
  again if a meal isn't logged an hour later; on iPhone turn on "Meal reminders" and allow notifications; on the web
  add the app to the Home Screen and enable reminders), Ramadan & fasting mode (on/off/auto, suhoor and iftar times, plus voluntary fasting days outside Ramadan: pick weekdays such as
  Monday and Thursday and/or the White Days 13–15 of each Hijri month; never applied on Eid al-Fitr, Eid al-Adha or the Tashreeq days;
  on those days the app switches to the fasting split, tips and reminders automatically), WHOOP connect/disconnect,
  Apple Health (iPhone app only: syncs burned energy, workouts and weight), Appearance (Auto / Light / Dark — Auto
  follows the phone), Language (English / العربية), sign out.

## WHOOP recovery & sleep
With WHOOP connected, Today shows a "Recovery & sleep" card (recovery %, sleep time vs need, day strain); tapping it
opens details: HRV, resting HR, SpO2, skin temp, respiratory rate, sleep stages, performance and efficiency, with a
7-day recovery chart. Older connections must tap "Reconnect WHOOP" once to allow recovery and sleep. Low recovery or
short sleep → suggest easy, protein-rich, hydrating food and warn about cravings; no extra restriction.

## Morning plan, after-workout note and the extra-burn allowance
- Morning plan card (and a notification 05:00–12:00 once WHOOP recovery is in): recovery band (green ≥67 / yellow
  34–66 / red ≤33) → harder session with carbs around it / moderate session / rest and focus on protein + water;
  short sleep → hunger warning; last coffee 6 h before the usual bedtime; protein goal at ~20–40 g per meal.
- After a workout of ≥20 min or ≥150 kcal (WHOOP), a card + notification within 3 h: protein ≈0.3 g/kg (20–40 g)
  within ~2 h, with carbs if the session was ≥60 min / strain ≥14 / ≥600 kcal; at iftar when fasting; drink water.
- Extra-burn allowance: when the device burn (projected to a full day) beats the plan's expected burn by ≥100 kcal,
  half of the extra (rounded, max 1000) is added to today's budget — device calorie estimates are rough, so only half.
  It never lowers the budget. The Left ring shows "+N from burn" and meal slots scale with it.
- WHOOP is re-synced in the background about every 20 min (05:00–23:00) for users with notifications on.

## Apple Health on the website
A website can't read Apple Health. Settings → Burn source → Apple Health offers an iPhone Shortcut: copy the personal
sync link, build the Shortcut (Find Health Samples: Active Energy / Resting Energy, start date today → Calculate
Statistics: Sum → Get Contents of URL, POST, JSON body active + basal) and add Time of Day automations (e.g. 12:00,
18:00, 22:00, Run Immediately). "Check data received" shows the last time it arrived. The iPhone app syncs Apple
Health by itself (pull down to refresh).

## Connect StrainEat to Claude, ChatGPT or Gemini (beta)
What it does: after connecting once, the user can snap or describe a meal in Claude / ChatGPT / Gemini and say
"log it in StrainEat" — it is saved to their StrainEat account (confirmed). They can also ask "how many calories do I
have left?", log water and weight. The analysis runs on their own subscription to that AI app. In Claude and ChatGPT a
StrainEat review card appears in the chat (adjust amounts −/+, delete, open in app); Gemini shows a text reply.
The server link (give it exactly, as a code span, on its own line): \`{{MCP_URL}}\`
This link is NOT secret — each person signs in to their own StrainEat account during connection and taps Allow.
Never ask for or give passwords, keys or tokens. The "Advanced: connect with a key" option in Settings is only for apps
without sign-in; don't recommend it unless the user asks, and never paste a key in chat.
Adding the connector is done on that AI's WEBSITE in any browser — Safari/Chrome on the phone works too (open claude.ai,
chatgpt.com or gemini.google.com in the browser, not inside their app; tested with Claude in iPhone Safari). Once added it
also works in that app's phone app.

Claude (claude.ai in a browser — phone Safari is fine):
1. Open claude.ai → Settings (or Customize) → Connectors.
2. Tap "+" / "Add custom connector". Name: StrainEat. Remote MCP server URL: the link above. Tap Add.
3. Tap Connect next to StrainEat → the StrainEat page opens → sign in if asked → tap "Allow".
4. In a chat, open the tools menu ("+" under the message box) → Connectors → turn StrainEat on.
5. Try: send a meal photo and write "log this in StrainEat", or "how many calories do I have left in StrainEat?".
Notes: on the Free plan Claude allows one custom connector. If it says "Couldn't start sign-in", remove the connector and
add it again with the link above.

ChatGPT (chatgpt.com in a browser; developer mode needs a paid plan):
1. Settings → Apps → Advanced settings → turn on "Developer mode".
2. Back in Apps tap "Create app". Name: StrainEat. MCP server URL: the link above. Authentication: OAuth.
3. Tick "I understand / trust this app" → Create → the StrainEat page opens → sign in if asked → "Allow".
4. In a new chat tap "+" → More / Developer mode → choose StrainEat, then send a meal photo with "log this in StrainEat".
ChatGPT asks for confirmation before each save — that's normal.

Gemini (gemini.google.com in a browser):
1. Open gemini.google.com/devmode (Gemini → Settings → Gemini Apps Developer Mode).
2. Tap "+ Create new", paste the link above into "MCP Server URL" (leave Additional settings empty).
3. Tick the consent box → Connect → the StrainEat page opens → sign in if asked → "Allow".
4. Name it StrainEat, check the actions listed (log_meal, today_summary, log_water, log_weight) → Connect.
5. Try it in the chat next to it. If Developer Mode doesn't appear, Google hasn't enabled it for that account or region yet.

Managing: StrainEat Settings → "Log from ChatGPT, Claude or Gemini" shows the same link with a copy button and the list of
connected apps with "Disconnect". Disconnecting there cuts access immediately.
Troubleshooting: "nothing happens / it answers without StrainEat" → make sure StrainEat is switched on in that chat's
tools and mention StrainEat in the message; start a new chat after connecting. Wrong numbers → edit the meal in the
card or in StrainEat; packaged products: ask the AI to use the label values.

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
