<div dir="rtl" lang="he">

# Morning MCP — חיבור אישי לסוכן AI

MVP קהילתי עצמאי; אינו מוצר רשמי של מורנינג. הסוכן קורא נתונים ומכין טיוטות. **כל שינוי במורנינג דורש אישור שלכם**, כולל הפקת חשבונית, שליחת מסמך, העלאת הוצאה, תשלום, עדכון או מחיקה. אין הרשמה למערכת נוספת ואין צורך במסד נתונים משותף.

[מדריך מלא בעברית עם צילומים](docs/setup-guide.html) — פותחים בדפדפן. צילום המפתחות הושחר; אין בו מפתחות או סודות גלויים.

## 1. מתקינים

צריך **Node.js 22 ומעלה**. מורידים את [קובץ ההתקנה](https://github.com/ishayshalev/morning-mcp/releases/download/v0.1.0/morning-desk-mcp-0.1.0.tgz), פותחים Terminal ומריצים:

<pre dir="ltr"><code>npm install -g /absolute/path/to/morning-desk-mcp-0.1.0.tgz</code></pre>

מחליפים את הנתיב במיקום הקובץ שהורדתם. החבילה **עדיין לא פורסמה ב־npm**; ההתקנה מיועדת כרגע ל־macOS ול־Linux.

## 2. יוצרים מפתח במורנינג

נכנסים ל־**אזור אישי ← כלים למפתחים ← מפתחות API**, או [פותחים את העמוד ישירות](https://app.greeninvoice.co.il/settings/developers/api). לוחצים על **+**, נותנים שם כמו Morning MCP, קוראים ומאשרים את התנאים ושומרים.

![טופס יצירת מפתח — שם, תנאים ושמירה, ללא ערכי מפתחות](docs/screenshots/02-create-key-numbered.jpg)

מעתיקים בנפרד את **מזהה המפתח** ואת **המפתח הסודי**. הסוד מוצג פעם אחת בלבד: שומרים אותו בבטחה לפני סגירת החלון. אם איבדתם אותו, צריך ליצור מפתח חדש. לא מדביקים מפתחות בצ׳אט עם הסוכן. [לפי מורנינג](https://www.greeninvoice.co.il/help-center/generating-api-key/), גישה ל־API זמינה במסלול Best ומעלה, בכפוף להרשאות החשבון.

![צילום מסך המפתחות במורנינג — מזהה המפתח מושחר](docs/screenshots/03-morning-keys-redacted.jpg)

במסך המפתחות לוחצים על המזהה להעתקה. הסוד מופיע רק בחלון שאחרי יצירת המפתח; הוא אינו מוצג בצילום הזה. ההשחרה אטומה וערכי המפתח אינם כלולים בקובץ התמונה.

## 3. מוסיפים את המפתחות

<pre dir="ltr"><code>morning-mcp setup</code></pre>

| השורה שמופיעה ב־Terminal | מה עושים |
| --- | --- |
| <code dir="ltr">Morning API key ID:</code> | מדביקים את המזהה ולוחצים Enter |
| <code dir="ltr">Environment [production/sandbox] (production):</code> | לחשבון רגיל לוחצים Enter; רק למפתחות בדיקה בוחרים sandbox |
| <code dir="ltr">Morning secret (hidden):</code> | מדביקים את הסוד ולוחצים Enter |

**הסוד נשאר בלתי נראה, גם בלי נקודות — זה תקין.** במק מדביקים עם ⌘V. לא מוסיפים סוגריים <code dir="ltr">&lt; &gt;</code>. המפתחות נשמרים במחשב שלכם; ההגדרה לא מבצעת פעולה במורנינג.

![היכן מדביקים מזהה וסוד — תרשים בעברית, ללא מפתחות](docs/screenshots/04-where-to-paste-example.jpg)

## 4. מחברים את הסוכן

**Codex:**

<pre dir="ltr"><code>codex mcp add morning -- morning-mcp</code></pre>

מוסיפים לקובץ <code dir="ltr">~/.codex/config.toml</code> כדי שהביצוע יבקש אישור:

<pre dir="ltr"><code>[mcp_servers.morning.tools.execute_draft]
approval_mode = "prompt"</code></pre>

**Claude Code:**

<pre dir="ltr"><code>claude mcp add --transport stdio morning -- morning-mcp</code></pre>

**Claude Desktop או סוכן אחר:** מגדירים שרת MCP מקומי מסוג <code dir="ltr">stdio</code>, עם הפקודה <code dir="ltr">morning-mcp</code> וללא ארגומנטים. [דוגמת הגדרה](examples/claude-desktop.json).

אם האפליקציה לא מוצאת את הפקודה, משתמשים בנתיב המלא שמחזירה <code dir="ltr">command -v morning-mcp</code>. לאחר ההגדרה מחברים מחדש או מפעילים מחדש את הסוכן.

**לביצוע צריך תמיכה בחלון אישור של MCP.** בסוכן בלי תמיכה אפשר לקרוא ולהכין טיוטות בלבד. לא מגדירים אישור אוטומטי. התאימות בפועל עדיין לא נבדקה.

## 5. משתמשים

אומרים לסוכן: **״הכן טיוטת חשבונית והראה לי את התצוגה המקדימה לפני ההפקה.״** בודקים את ה־PDF ואת פרטי המשלוח, ורק אז מאשרים בחלון של הסוכן.

להוצאות אפשר להכין PDF, JPEG או PNG עד **20MB**. ההעלאה דורשת אישור. טיוטת הוצאה שנוצרה מפענוח קובץ משלימים במורנינג; אין ב־API המתועד פעולה לסיום הטיוטה. הצלחת הבקשה אינה הוכחה להגעת דוא״ל או לסיום עיבוד הקובץ.

טיוטה תקפה ל־24 שעות ונקשרת לתוכן המדויק ולחיבור. שינוי מחייב טיוטה ואישור חדשים. לחיוב כרטיס מקלידים <code dir="ltr">CHARGE</code>; למחיקה או איחוד מקלידים <code dir="ltr">CONFIRM</code>. אם התוצאה לא ברורה, בודקים במורנינג לפני ניסיון נוסף — השרת לא חוזר על הפעולה אוטומטית.

<details>
<summary>מידע נוסף: אחסון, כיסוי API והגדרות</summary>

המפתחות נשמרים בקובץ פרטי <code dir="ltr">~/.morning-mcp/config.json</code>; טיוטות וקבצים נשמרים בנפרד לכל חשבון וסביבה תחת <code dir="ltr">~/.morning-mcp/data/</code>. הם **לא נמחקים אוטומטית**. הרשאות הקבצים במק וב־Linux מוגבלות לבעלים; אין הצפנת Keychain. אין לתת לסוכן גישה ישירה למפתחות. מנגנון האישור מסתמך על האפליקציה שמציגה אותו; אין להגדיר בה אישורים אוטומטיים.

הקטלוג כולל 54 פעולות API מתועדות; 23 פעולות עסקיות עוברות דרך אישור. אימות והעלאת קובץ מנוהלים פנימית. פעולות שותפים וקבלת Webhooks אינן ממומשות. זהו כיסוי בקוד ובסכמות, לא אימות חי של כל פעולה. [רשימת הפעולות והחריגים](API-COVERAGE.md).

אפשר להשתמש במשתני סביבה במקום קובץ: מגדירים **גם** <code dir="ltr">MORNING_CLIENT_ID</code> **וגם** <code dir="ltr">MORNING_CLIENT_SECRET</code>. ברירת המחדל של <code dir="ltr">MORNING_ENV</code> היא <code dir="ltr">production</code>.

| הגדרה אופציונלית | שימוש |
| --- | --- |
| <code dir="ltr">MORNING_CONFIG_FILE</code> | נתיב אחר לקובץ המפתחות |
| <code dir="ltr">MORNING_DATA_DIR</code> | תיקייה אחרת לטיוטות ולקבצים |
| <code dir="ltr">MORNING_WRITES_ENABLED=false</code> | חסימת ביצוע; קריאה והכנת טיוטות עדיין זמינות |

חלון האישור משתמש בהמשך בקשה חתום, התקף לעשר דקות. הפעלה מחדש דורשת אישור חדש. התנהגות הרשאות הקבצים ב־Windows לא נבדקה.

להתקנה מקוד המקור:

<pre dir="ltr"><code>git clone https://github.com/ishayshalev/morning-mcp.git
cd morning-mcp
npm ci --ignore-scripts
npm link
morning-mcp setup</code></pre>

אפשר גם להפעיל עם Node ונתיב מלא ל־<code dir="ltr">bin/morning-mcp.mjs</code>.

בוצעה סקירת קוד ובדיקת תחביר ואריזה. בדיקות תאימות אישור ופעולות חיות במורנינג עדיין לא בוצעו. בזמן הבנייה לא הונפקה חשבונית, לא בוצע חיוב ולא הועלתה הוצאה.

הקוד פתוח ברישיון [MIT](LICENSE). דיווחי תקלות: [GitHub Issues](https://github.com/ishayshalev/morning-mcp/issues). אין לצרף מפתחות או מסמכים פרטיים.

[API של מורנינג](https://developers.morning.co/api) · [הגדרות Codex](https://developers.openai.com/codex/config-reference) · [חיבור Claude](https://code.claude.com/docs/en/mcp) · [אישור דרך MCP](https://ts.sdk.modelcontextprotocol.io/v2/servers/input-required.html)

</details>

</div>
