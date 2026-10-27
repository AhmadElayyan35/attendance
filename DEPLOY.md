# رفع التطبيق على Render — خطوة بخطوة

التكلفة المتوقعة: خطة Starter + قرص 1GB ≈ **$7.25 شهريًا** (تأكد من صفحة الأسعار الرسمية قبل الدفع).

## 1) رفع المشروع على GitHub
1. ادخل [github.com](https://github.com) وأنشئ حسابًا إن لم يكن لديك.
2. اضغط **New repository**:
   - الاسم: `attendance` (أو أي اسم)
   - اختر **Private** (مهم)
   - لا تضف README ولا .gitignore (المشروع جاهز)
3. انسخ رابط المستودع (مثل `https://github.com/USERNAME/attendance.git`) ونفّذ داخل مجلد `C:\hr system`:

```bash
git remote add origin https://github.com/USERNAME/attendance.git
```

```bash
git push -u origin main
```

   ستفتح نافذة تسجيل دخول GitHub أول مرة — وافق عليها.

## 2) إنشاء الخدمة على Render
1. ادخل [render.com](https://render.com) واضغط **Get Started** ← سجّل باستخدام **GitHub**.
2. من الأعلى: **New +** ← **Blueprint**.
3. اربط حساب GitHub واختر مستودع `attendance`. سيقرأ Render ملف `render.yaml` تلقائيًا ويعرض:
   - خدمة ويب اسمها `attendance` (خطة Starter، منطقة Frankfurt)
   - قرص دائم `attendance-data` على `/data` بحجم 1GB
4. سيطلب منك قيمتين:
   - `ADMIN_USERNAME`: اسم دخول المدير (إنجليزي، مثل `ali`)
   - `ADMIN_PASSWORD`: كلمة مرور قوية (8 أحرف على الأقل) — احفظها عندك
5. اضغط **Apply**، وأضف بطاقة الدفع إذا طُلب منك.
6. انتظر 3–5 دقائق حتى تصبح الحالة **Live**. في **Logs** يجب أن ترى:
   `Created manager account "..."` ثم `Attendance app listening`.

## 3) أول دخول
1. افتح الرابط الظاهر أعلى صفحة الخدمة (مثل `https://attendance-xxxx.onrender.com`).
2. ادخل باسم المدير وكلمة المرور.
3. **مهم:** في Render ← الخدمة ← **Environment** احذف `ADMIN_PASSWORD` واحفظ (الحساب أصبح محفوظًا في قاعدة البيانات).
4. من **الموظفون** أضف الموظفين، وأرسل لكل واحد الرابط + بيانات دخوله.

## 4) تثبيته على هواتف الموظفين
- **Android (Chrome):** افتح الرابط ← زر «تثبيت» في التطبيق، أو ⋮ ← «تثبيت التطبيق».
- **iPhone (Safari):** افتح الرابط ← زر المشاركة ⬆︎ ← «إضافة إلى الشاشة الرئيسية».
- أول تسجيل دخول للدوام سيطلب الهاتف إذن الموقع ← «السماح».

## 5) التحديثات لاحقًا
أي تعديل يُرفع بـ `git push` يُنشر تلقائيًا خلال دقائق، والبيانات تبقى على القرص.

## دومين خاص (اختياري)
Render ← الخدمة ← **Settings** ← **Custom Domains** ← أضف النطاق (مثل `hudoor.company.com`)، ثم أضف سجل CNAME عند مزوّد الدومين كما يعرضه Render. شهادة HTTPS تُصدر تلقائيًا.

## إذا حصلت مشكلة
- فشل البناء أو التشغيل: انسخ آخر سطور **Logs** وأرسلها.
- نسيت كلمة مرور المدير: Render ← الخدمة ← **Shell** ← `npm run create-manager` (تعيد تعيين كلمة المرور).
- النسخ الاحتياطية اليومية محفوظة في `/data/backups` على نفس القرص.
