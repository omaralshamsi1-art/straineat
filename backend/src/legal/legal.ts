/**
 * Privacy policy, terms of use and support page (Arabic + English), served as plain HTML.
 * Publisher name / contact come from env so the text matches the App Store seller exactly.
 */
export type LegalPage = 'privacy' | 'terms' | 'support';
export type Lang = 'ar' | 'en';
export interface LegalOpts { name: string; email: string; geminiTier: 'paid' | 'free'; base: string }

export const LEGAL_UPDATED = '2026-11-26';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function privacy(o: LegalOpts, ar: boolean): string {
  const n = esc(o.name), m = `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>`;
  const tier = ar
    ? o.geminiTier === 'paid'
      ? 'نستخدم خدمة Gemini API المدفوعة، وبحسب شروط Google لا تُستخدم هذه البيانات لتدريب نماذجها أو تحسين منتجاتها، وقد تحتفظ بها Google لفترة محدودة لكشف إساءة الاستخدام فقط.'
      : 'نستخدم حالياً الفئة المجانية من Gemini API، وبحسب شروط Google قد تُستخدم البيانات المرسلة لتحسين منتجاتها وقد يطّلع عليها مراجعون بشريون. لا ترسل في وصف الوجبة أي معلومة لا تريد مشاركتها.'
    : o.geminiTier === 'paid'
      ? 'We use the paid Gemini API service. Under Google’s terms this data is not used to train its models or improve its products; Google may keep it for a limited time for abuse monitoring only.'
      : 'We currently use the free tier of the Gemini API. Under Google’s terms, content sent on the free tier may be used to improve Google’s products and may be read by human reviewers. Don’t include anything in a meal description that you don’t want shared.';
  if (ar) return `
<h1>سياسة الخصوصية</h1>
<p class="muted">آخر تحديث: ${LEGAL_UPDATED}</p>
<p>StrainEat تطبيق لتتبّع الأكل والطاقة، ينشره <b>${n}</b> (مطوّر فردي في الإمارات العربية المتحدة) — «نحن». هذه السياسة تشرح وش البيانات اللي نجمعها، وليش، ومع من نشاركها، وكيف تتحكم فيها. للتواصل: ${m}.</p>

<h2>1. البيانات اللي نجمعها</h2>
<ul>
<li><b>الحساب:</b> الاسم، والبريد الإلكتروني، وكلمة المرور (نحفظها مُشفّرة بطريقة لا يمكن عكسها).</li>
<li><b>الملف الشخصي:</b> العمر، والجنس، والطول، والوزن، والهدف ووتيرته، ومستوى النشاط، والمنطقة الزمنية، والمدينة أو المنطقة إذا أدخلتها، وإعدادات الصيام ورمضان، والتذكيرات، واللغة.</li>
<li><b>سجل الأكل:</b> أسماء الوجبات وعناصرها وقيمها الغذائية وأوقاتها، والوجبات المحفوظة المتكررة.</li>
<li><b>الصحة والنشاط:</b> الوزن، والماء، والخطوات، والتمارين، والسعرات المحروقة، والنوم والاستشفاء والجهد (من WHOOP).</li>
<li><b>من الخدمات اللي تربطها بنفسك:</b>
  <ul>
  <li><b>WHOOP:</b> الدورات اليومية، والجهد، والاستشفاء، والنوم، والتمارين، والخطوات، واسمك المختصر وبريدك مُخفى جزئياً.</li>
  <li><b>Apple Health (آيفون):</b> نقرأ السعرات النشطة والأساسية، والخطوات، والتمارين ومسافاتها، ونبض القلب، والوزن، والطول، والماء؛ ونكتب الوجبات والماء في تطبيق صحة إذا سمحت.</li>
  <li><b>اختصار Apple (Shortcuts):</b> السعرات والخطوات اللي يرسلها الاختصار برابطك الخاص.</li>
  <li><b>تطبيقات الذكاء الاصطناعي (Claude أو ChatGPT أو Gemini):</b> اسم التطبيق اللي ربطته وآخر استخدام، والوجبات والماء والوزن اللي تسجّلها من خلاله.</li>
  </ul></li>
<li><b>الإشعارات:</b> معرّف اشتراك الإشعارات من متصفحك أو جهازك.</li>
<li><b>بيانات تقنية:</b> عنوان IP، والمسارات المطلوبة، والأوقات، وتحفظها شركة الاستضافة في سجلات الخادم.</li>
</ul>

<h2>2. الصور والصوت</h2>
<p>صورة الوجبة تُرسل لتحليلها ثم <b>لا نحفظها</b>؛ نحفظ النتيجة فقط (العناصر والقيم). في الآيفون يحوّل نظام Apple للتعرّف على الكلام صوتك إلى نص (وقد تعالجه Apple حسب سياستها)، ونستقبل النص فقط.</p>

<h2>3. كيف نستخدم البيانات</h2>
<p>لتقدير القيم الغذائية، وحساب أهدافك اليومية وخطتك، وعرض تقدّمك، وإرسال التذكيرات اللي تفعّلها، ومزامنة أجهزتك، والرد على أسئلتك في «اسأل StrainEat». <b>لا نبيع بياناتك، ولا نعرض إعلانات، ولا نتتبّعك عبر تطبيقات أو مواقع أخرى</b>، ولا نستخدم بيانات Apple Health لأي غرض إعلاني أو تسويقي.</p>

<h2>4. معالجة الذكاء الاصطناعي</h2>
<p>لتحليل الوجبات والرد على أسئلتك، نرسل إلى <b>Google Gemini API</b>: صورة الوجبة أو وصفها، والسياق اللازم للإجابة (مثل أهدافك ومجموع يومك وحرقك وتمارينك). نطلب موافقتك قبل أول إرسال. ${tier}</p>

<h2>5. مع من نشارك البيانات</h2>
<p>فقط مع مزوّدين يعالجونها لتقديم الخدمة:</p>
<ul>
<li><b>Google (Gemini API)</b> — التحليل الذكي، كما في البند 4.</li>
<li><b>Railway</b> — الاستضافة وقاعدة البيانات (الخوادم في منطقة سنغافورة).</li>
<li><b>WHOOP</b> — فقط إذا ربطت حسابك، لجلب بياناتك منه.</li>
<li><b>Open Food Facts</b> — رقم الباركود فقط عند مسح منتج.</li>
<li><b>Apple / مزوّد متصفحك</b> — لإيصال الإشعارات.</li>
<li><b>تطبيق الذكاء الاصطناعي اللي تربطه أنت</b> — يستلم ما تطلبه عبر الربط، وتخضع المحادثة نفسها لسياسة ذلك التطبيق.</li>
</ul>
<p>قد نفصح عن بيانات إذا ألزمنا القانون بذلك.</p>

<h2>6. الاحتفاظ والحذف</h2>
<p>نحتفظ ببياناتك ما دام حسابك موجوداً. تقدر تحذف أي وجبة أو وزن أو ماء في أي وقت، وتفصل WHOOP وتطبيقات الذكاء الاصطناعي من الإعدادات. <b>حذف الحساب</b> (الإعدادات ← حذف الحساب) يمسح كل بياناتك من قاعدة البيانات فوراً ويلغي وصول WHOOP والتطبيقات المربوطة. قد تبقى نسخ في سجلات الخادم أو النسخ الاحتياطية لدى مزوّد الاستضافة لمدة محدودة (حتى 30 يوماً) ثم تُحذف.</p>

<h2>7. الحماية</h2>
<p>الاتصال مشفّر (HTTPS)، وكلمات المرور ومفاتيح الربط محفوظة مُجزّأة، ورموز الوصول قصيرة العمر، وكل حساب يصل لبياناته فقط. لا توجد طريقة حماية كاملة 100٪، لكن نعمل على حمايتها بشكل معقول.</p>

<h2>8. حقوقك</h2>
<p>لك أن تطّلع على بياناتك وتصحّحها وتحذفها، وتسحب موافقتك على معالجة الذكاء الاصطناعي أو الربط مع أي خدمة. لطلب نسخة من بياناتك أو أي استفسار راسلنا على ${m}، ونرد خلال 30 يوماً.</p>

<h2>9. الأعمار</h2>
<p>StrainEat مخصّص للبالغين (18 سنة فأكثر)، ولا نجمع عن قصد بيانات من هم أصغر.</p>

<h2>10. التغييرات</h2>
<p>إذا غيّرنا هذه السياسة نحدّث التاريخ أعلاه، ونبلغك داخل التطبيق إذا كان التغيير جوهرياً.</p>`;
  return `
<h1>Privacy Policy</h1>
<p class="muted">Last updated: ${LEGAL_UPDATED}</p>
<p>StrainEat is a food and energy tracking app published by <b>${n}</b>, an individual developer in the United Arab Emirates (“we”). This policy explains what we collect, why, who we share it with, and how you control it. Contact: ${m}.</p>

<h2>1. What we collect</h2>
<ul>
<li><b>Account:</b> name, email and password (stored as a one-way hash).</li>
<li><b>Profile:</b> age, sex, height, weight, goal and pace, activity level, time zone, the city or area you enter, fasting/Ramadan settings, reminders and language.</li>
<li><b>Food log:</b> meal names, items, nutrition values and times, and your saved repeat meals.</li>
<li><b>Health and activity:</b> weight, water, steps, workouts, calories burned, and sleep, recovery and strain (from WHOOP).</li>
<li><b>Services you choose to connect:</b>
  <ul>
  <li><b>WHOOP:</b> daily cycles, strain, recovery, sleep, workouts, steps, and your short name and partly masked email.</li>
  <li><b>Apple Health (iPhone):</b> we read active and resting energy, steps, workouts and distances, heart rate, weight, height and water; with your permission we write meals and water to Health.</li>
  <li><b>Apple Shortcuts:</b> the calories and steps your shortcut sends through your private link.</li>
  <li><b>AI apps (Claude, ChatGPT or Gemini):</b> which app you connected and when it was last used, plus the meals, water and weight you log through it.</li>
  </ul></li>
<li><b>Notifications:</b> your browser or device push subscription.</li>
<li><b>Technical data:</b> IP address, requested paths and timestamps, kept in server logs by our host.</li>
</ul>

<h2>2. Photos and voice</h2>
<p>Meal photos are sent for analysis and <b>not stored</b>; we keep only the result (items and values). On iPhone, Apple’s speech recognition turns your voice into text (Apple may process it under its own policy); we receive only the text.</p>

<h2>3. How we use data</h2>
<p>To estimate nutrition, calculate your daily targets and plan, show your progress, send reminders you turn on, sync your devices, and answer questions in “Ask StrainEat”. <b>We don’t sell your data, show ads, or track you across other apps or websites</b>, and we never use Apple Health data for advertising or marketing.</p>

<h2>4. AI processing</h2>
<p>To analyse meals and answer your questions we send to the <b>Google Gemini API</b>: the meal photo or description, and the context needed for the answer (such as your targets, today’s totals, burn and workouts). We ask for your consent before the first time. ${tier}</p>

<h2>5. Who we share data with</h2>
<p>Only providers that process it to run the service:</p>
<ul>
<li><b>Google (Gemini API)</b> — AI analysis, as in section 4.</li>
<li><b>Railway</b> — hosting and database (servers in the Singapore region).</li>
<li><b>WHOOP</b> — only if you connect your account, to fetch your data.</li>
<li><b>Open Food Facts</b> — only the barcode number when you scan a product.</li>
<li><b>Apple / your browser’s push service</b> — to deliver notifications.</li>
<li><b>The AI app you connect</b> — receives what you ask for through the connection; the chat itself is governed by that app’s policy.</li>
</ul>
<p>We may disclose data if the law requires it.</p>

<h2>6. Retention and deletion</h2>
<p>We keep your data while your account exists. You can delete any meal, weight or water entry at any time, and disconnect WHOOP and AI apps in Settings. <b>Deleting your account</b> (Settings → Delete account) immediately erases all your data from our database and revokes WHOOP and connected-app access. Copies in our host’s server logs or backups may remain for a limited time (up to 30 days) before they are removed.</p>

<h2>7. Security</h2>
<p>Connections are encrypted (HTTPS), passwords and connector keys are stored hashed, access tokens are short-lived, and each account can reach only its own data. No method is 100% secure, but we take reasonable measures to protect it.</p>

<h2>8. Your rights</h2>
<p>You can access, correct and delete your data, and withdraw consent to AI processing or to any connected service. For a copy of your data or any question, email ${m}; we reply within 30 days.</p>

<h2>9. Age</h2>
<p>StrainEat is for adults (18+). We don’t knowingly collect data from anyone younger.</p>

<h2>10. Changes</h2>
<p>If we change this policy we’ll update the date above and tell you in the app when a change is significant.</p>`;
}

function terms(o: LegalOpts, ar: boolean): string {
  const n = esc(o.name), m = `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>`;
  if (ar) return `
<h1>شروط الاستخدام</h1>
<p class="muted">آخر تحديث: ${LEGAL_UPDATED}</p>
<p>باستخدامك StrainEat (التطبيق والموقع وربط تطبيقات الذكاء الاصطناعي) توافق على هذه الشروط و<a href="${esc(o.base)}/privacy?lang=ar">سياسة الخصوصية</a>. الخدمة يقدّمها ${n}.</p>
<h2>1. ليس استشارة طبية</h2>
<p>StrainEat أداة لتتبّع الأكل والنشاط، <b>وليس جهازاً طبياً ولا بديلاً عن الطبيب أو أخصائي التغذية</b>. لا يشخّص أي حالة ولا يعالجها. استشر طبيبك قبل تغيير أكلك أو نشاطك بشكل كبير، وخصوصاً إذا كنت حاملاً أو مرضعاً، أو عندك سكري أو أمراض قلب أو كلى أو أي حالة مزمنة، أو تاريخ مع اضطرابات الأكل، أو تتبع نظاماً منخفض السعرات جداً. إذا حسيت بأعراض مقلقة اطلب مساعدة طبية فوراً.</p>
<h2>2. الأرقام تقديرية</h2>
<p>القيم الغذائية والسعرات المحروقة والأهداف تقديرات من الذكاء الاصطناعي والمعادلات والأجهزة، وقد تكون غير دقيقة. راجعها وعدّلها، ولا تعتمد عليها وحدها في قرارات صحية.</p>
<h2>3. الأهلية والحساب</h2>
<p>يجب أن يكون عمرك 18 سنة أو أكثر. أنت مسؤول عن سرية كلمة المرور وروابط ومفاتيح الربط الخاصة بك، وعن أي نشاط يتم من خلالها.</p>
<h2>4. الاستخدام المقبول</h2>
<p>لا تستخدم الخدمة لأي غرض غير قانوني، ولا تحاول الوصول لبيانات غيرك أو تعطيل الخدمة أو إساءة استخدام الواجهات أو تجاوز حدود الطلبات.</p>
<h2>5. الخدمات المربوطة</h2>
<p>ربط WHOOP وApple Health وتطبيقات الذكاء الاصطناعي اختياري، ويخضع استخدامك لتلك الخدمات لشروطها. ما نتحكم في تلك الخدمات ولا في توفّرها.</p>
<h2>6. ميزات تجريبية وتغييرات</h2>
<p>بعض الميزات تجريبية وقد تتغير أو تتوقف. نقدّم الخدمة «كما هي» بدون ضمانات بأنها ستكون متاحة دائماً أو خالية من الأخطاء.</p>
<h2>7. حدود المسؤولية</h2>
<p>إلى الحد الذي يسمح به القانون، لا نتحمّل مسؤولية أي ضرر غير مباشر أو تبعي ناتج عن استخدام الخدمة أو الاعتماد على تقديراتها.</p>
<h2>8. إنهاء الحساب</h2>
<p>تقدر تحذف حسابك أي وقت من الإعدادات. وقد نوقف حساباً يخالف هذه الشروط.</p>
<h2>9. القانون</h2>
<p>تخضع هذه الشروط لقوانين دولة الإمارات العربية المتحدة.</p>
<h2>10. التواصل</h2>
<p>${m}</p>`;
  return `
<h1>Terms of Use</h1>
<p class="muted">Last updated: ${LEGAL_UPDATED}</p>
<p>By using StrainEat (the app, the website and the AI-app connection) you agree to these terms and the <a href="${esc(o.base)}/privacy?lang=en">Privacy Policy</a>. The service is provided by ${n}.</p>
<h2>1. Not medical advice</h2>
<p>StrainEat is a food and activity tracking tool. <b>It is not a medical device and not a substitute for a doctor or dietitian</b>; it does not diagnose or treat any condition. Talk to your doctor before making major changes to your diet or activity — especially if you are pregnant or breastfeeding, have diabetes, heart or kidney disease or any chronic condition, have a history of eating disorders, or follow a very-low-calorie diet. If you have worrying symptoms, seek medical help right away.</p>
<h2>2. Numbers are estimates</h2>
<p>Nutrition values, calories burned and targets are estimates from AI, formulas and devices, and can be wrong. Review and correct them, and don’t rely on them alone for health decisions.</p>
<h2>3. Eligibility and account</h2>
<p>You must be 18 or older. You are responsible for keeping your password and your private connection links and keys secret, and for activity that happens through them.</p>
<h2>4. Acceptable use</h2>
<p>Don’t use the service unlawfully, try to access other people’s data, disrupt the service, abuse the APIs or bypass rate limits.</p>
<h2>5. Connected services</h2>
<p>Connecting WHOOP, Apple Health or AI apps is optional and your use of them is governed by their own terms. We don’t control those services or their availability.</p>
<h2>6. Beta features and changes</h2>
<p>Some features are in beta and may change or stop. The service is provided “as is”, without a guarantee that it will always be available or error-free.</p>
<h2>7. Limitation of liability</h2>
<p>To the extent permitted by law, we are not liable for indirect or consequential loss arising from using the service or relying on its estimates.</p>
<h2>8. Ending your account</h2>
<p>You can delete your account at any time in Settings. We may suspend an account that breaks these terms.</p>
<h2>9. Law</h2>
<p>These terms are governed by the laws of the United Arab Emirates.</p>
<h2>10. Contact</h2>
<p>${m}</p>`;
}

function support(o: LegalOpts, ar: boolean): string {
  const m = `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>`;
  if (ar) return `
<h1>الدعم</h1>
<p>لأي سؤال أو مشكلة أو طلب يخص بياناتك راسلنا على ${m}.</p>
<h2>حذف الحساب</h2>
<p>من التطبيق: الإعدادات ← حذف الحساب ← اكتب DELETE للتأكيد. يُمسح كل شي فوراً. إذا ما تقدر تدخل حسابك راسلنا من بريدك المسجّل.</p>
<h2>فصل الخدمات</h2>
<p>الإعدادات ← WHOOP أو «سجّل من ChatGPT أو Claude أو Gemini» ← إلغاء الربط. وفي الآيفون تقدر توقف صلاحيات صحة من تطبيق صحة ← المشاركة ← التطبيقات.</p>
<p><a href="${esc(o.base)}/privacy?lang=ar">سياسة الخصوصية</a> · <a href="${esc(o.base)}/terms?lang=ar">شروط الاستخدام</a></p>`;
  return `
<h1>Support</h1>
<p>For any question, problem or data request, email ${m}.</p>
<h2>Delete your account</h2>
<p>In the app: Settings → Delete account → type DELETE to confirm. Everything is erased immediately. If you can’t sign in, email us from your registered address.</p>
<h2>Disconnect services</h2>
<p>Settings → WHOOP, or “Log from ChatGPT, Claude or Gemini” → Disconnect. On iPhone you can also turn off Health access in Health → Sharing → Apps.</p>
<p><a href="${esc(o.base)}/privacy?lang=en">Privacy Policy</a> · <a href="${esc(o.base)}/terms?lang=en">Terms of Use</a></p>`;
}

export function renderLegal(page: LegalPage, lang: Lang, o: LegalOpts): string {
  const ar = lang === 'ar';
  const body = page === 'privacy' ? privacy(o, ar) : page === 'terms' ? terms(o, ar) : support(o, ar);
  const titles = { privacy: ['Privacy Policy', 'سياسة الخصوصية'], terms: ['Terms of Use', 'شروط الاستخدام'], support: ['Support', 'الدعم'] };
  const other = ar ? 'en' : 'ar';
  return `<!doctype html><html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StrainEat — ${titles[page][ar ? 1 : 0]}</title>
<style>body{font:16px/1.7 -apple-system,system-ui,"Segoe UI",Tahoma,sans-serif;max-width:760px;margin:0 auto;padding:24px 20px 60px;color:#1b1f23;background:#fff}
h1{font-size:28px;margin:8px 0 4px}h2{font-size:19px;margin:28px 0 6px}ul{padding-inline-start:22px}li{margin:4px 0}.muted{color:#6a737d;font-size:14px}
a{color:#0b6bcb}header{display:flex;justify-content:space-between;align-items:center;font-size:14px}
@media(prefers-color-scheme:dark){body{background:#111417;color:#e6e6e6}.muted{color:#9aa4ad}a{color:#7cb8ff}}</style></head>
<body><header><b>StrainEat</b><a href="?lang=${other}">${ar ? 'English' : 'العربية'}</a></header>${body}</body></html>`;
}
