# رفع التطبيق — نسخة تجريبية مجانية (Render + Turso)

- **Render (مجاني):** يشغّل التطبيق ويعطيك رابط HTTPS.
- **Turso (مجاني):** يحفظ قاعدة البيانات بشكل دائم (Render المجاني يمسح ملفاته عند كل توقف).
- **ملاحظة:** Render المجاني ينام بعد 15 دقيقة بدون زيارات؛ أول فتح بعدها ينتظر حوالي دقيقة. الحل المجاني في الخطوة 5.

المستودع على GitHub جاهز. بعد أي تعديل: `git push` والنشر تلقائي.

## 1) قاعدة البيانات على Turso
1. ادخل [turso.tech](https://turso.tech) ← **Sign up** ← سجّل بحساب GitHub.
2. من اللوحة: **Create Database**:
   - الاسم: `attendance`
   - الموقع (Location): الأقرب لفرانكفورت (مثل `AWS Frankfurt / eu-central-1`)
3. افتح قاعدة البيانات واحفظ قيمتين:
   - **URL**: يبدأ بـ `libsql://` (مثل `libsql://attendance-xxxx.turso.io`)
   - **Token**: من **Generate Token / Create Token** (صلاحية قراءة وكتابة، بدون انتهاء). انسخه فورًا — لا يظهر مرة ثانية.

## 2) الخدمة على Render
1. ادخل [render.com](https://render.com) ← سجّل بحساب GitHub **AhmadElayyan35**، واسمح له بالوصول لمستودع `attendance` فقط.
2. **New +** ← **Blueprint** ← اختر `attendance` ← **Connect**.
3. سيظهر أنه سينشئ خدمة `attendance` بالخطة **Free**، ويطلب 4 قيم:
   - `DATABASE_URL`: رابط Turso (يبدأ بـ `libsql://`)
   - `DATABASE_AUTH_TOKEN`: التوكن من Turso
   - `ADMIN_USERNAME`: اسم دخولك (إنجليزي، مثل `ali`)
   - `ADMIN_PASSWORD`: كلمة مرور قوية (8+ أحرف) — احفظها
4. **Apply**. لا يحتاج بطاقة للخطة المجانية.
5. افتح الخدمة ← **Logs**، وانتظر 3–5 دقائق حتى ترى:
   `Database: attendance-xxxx.turso.io` ثم `Created manager account "ali"` ثم `Attendance app listening`.

## 3) أول دخول
1. افتح الرابط أعلى صفحة الخدمة (مثل `https://attendance-xxxx.onrender.com`) وادخل كمدير.
2. Render ← الخدمة ← **Environment** ← احذف `ADMIN_PASSWORD` ← **Save Changes**.
3. من **الموظفون** أضف الموظفين وأرسل لهم الرابط وبيانات الدخول.

## 4) على هواتف الموظفين
- **Android (Chrome):** زر «تثبيت» في التطبيق، أو ⋮ ← «تثبيت التطبيق».
- **iPhone (Safari):** زر المشاركة ⬆︎ ← «إضافة إلى الشاشة الرئيسية».
- أول تسجيل دوام يطلب الهاتف إذن الموقع ← «السماح».

## 5) (اختياري) منع النوم — مجانًا
1. ادخل [cron-job.org](https://cron-job.org) وأنشئ حسابًا مجانيًا.
2. **Create cronjob**: الرابط `https://attendance-xxxx.onrender.com/api/health`، كل **10 دقائق**.
هكذا يبقى التطبيق جاهزًا دائمًا. (التشغيل المتواصل يستهلك حوالي 744 ساعة من 750 ساعة مجانية شهريًا — يكفي لخدمة واحدة فقط.)

## الترقية بعد الموافقة (مدفوع)
Render ← الخدمة ← **Settings** ← **Instance Type** ← **Starter** (~$7/شهر). لا شيء آخر يتغير: البيانات تبقى على Turso، والتطبيق لا ينام. يمكنك حينها إيقاف cron-job.

## إذا حصلت مشكلة
- فشل البناء أو التشغيل: انسخ آخر سطور **Logs** وأرسلها.
- `Startup failed`: غالبًا `DATABASE_URL` أو `DATABASE_AUTH_TOKEN` غير صحيح — انسخهما من Turso مرة أخرى.
- نسيت كلمة مرور المدير: من جهازك في PowerShell داخل `C:\hr system` (بقيم Turso نفسها):

```powershell
$env:DATABASE_URL="libsql://attendance-xxxx.turso.io"; $env:DATABASE_AUTH_TOKEN="التوكن"; npm run create-manager
```

  ثم أدخل اسم المستخدم نفسه وكلمة مرور جديدة.
