<div dir="rtl" lang="he">

# עוד קצת פרטים

המפתחות נשמרים בקובץ פרטי <code dir="ltr">~/.morning-mcp/config.json</code>; טיוטות וקבצים נשמרים בנפרד לכל חשבון וסביבה תחת <code dir="ltr">~/.morning-mcp/data/</code>. הם **לא נמחקים אוטומטית**. הרשאות הקבצים במק וב־Linux מוגבלות לבעלים; אין הצפנת Keychain. אין לתת לסוכן גישה ישירה למפתחות. מנגנון האישור מסתמך על האפליקציה שמציגה אותו; אין להגדיר בה אישורים אוטומטיים.

הקטלוג כולל 54 פעולות API מתועדות; 23 פעולות עסקיות עוברות דרך אישור. אימות והעלאת קובץ מנוהלים פנימית. פעולות שותפים וקבלת Webhooks אינן ממומשות. זהו כיסוי בקוד ובסכמות, לא אימות חי של כל פעולה. [רשימת הפעולות והחריגים](../API-COVERAGE.md).

אפשר להשתמש במשתני סביבה במקום קובץ: מגדירים **גם** <code dir="ltr">MORNING_CLIENT_ID</code> **וגם** <code dir="ltr">MORNING_CLIENT_SECRET</code>. ברירת המחדל של <code dir="ltr">MORNING_ENV</code> היא <code dir="ltr">production</code>.

| הגדרה אופציונלית | שימוש |
| --- | --- |
| <code dir="ltr">MORNING_CONFIG_FILE</code> | נתיב אחר לקובץ המפתחות |
| <code dir="ltr">MORNING_DATA_DIR</code> | תיקייה אחרת לטיוטות ולקבצים |
| <code dir="ltr">MORNING_WRITES_ENABLED=false</code> | חסימת ביצוע; קריאה והכנת טיוטות עדיין זמינות |

חלון האישור משתמש בהמשך בקשה חתום, התקף לעשר דקות. הפעלה מחדש דורשת אישור חדש. התנהגות הרשאות הקבצים ב־Windows לא נבדקה.

[הוראות ההתקנה לסוכן](INSTALL-AGENT.md) כוללות את פקודות ההתקנה והגדרת הלקוחות. החיבור פועל עם Node והנתיב המלא לקובץ השרת.

בוצעה סקירת קוד ובדיקת תחביר ואריזה. בדיקות תאימות אישור ופעולות חיות במורנינג עדיין לא בוצעו. בזמן הבנייה לא הונפקה חשבונית, לא בוצע חיוב ולא הועלתה הוצאה.

הקוד פתוח ברישיון [MIT](../LICENSE). דיווחי תקלות: [GitHub Issues](https://github.com/ishayshalev/morning-mcp/issues). אין לצרף מפתחות או מסמכים פרטיים.

[API של מורנינג](https://developers.morning.co/api) · [הגדרות Codex](https://developers.openai.com/codex/config-reference) · [חיבור Claude](https://code.claude.com/docs/en/mcp) · [אישור דרך MCP](https://ts.sdk.modelcontextprotocol.io/v2/servers/input-required.html)



</div>
