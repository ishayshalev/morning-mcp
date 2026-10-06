<div dir="rtl" lang="he">

# כיסוי API של מורנינג

הקטלוג נבדק מול Morning OpenAPI 2.0.0 ב־4 באוקטובר 2026. הוא כולל 54 פעולות: 25 קריאות ותצוגות מקדימות, 23 פעולות עסקיות באישור הבעלים ו־6 פעולות אימות, העלאה או שותפים שמטופלות בנפרד.

הסוכן משתמש בכלי גילוי הפעולות והסכמות, קורא דרך read_morning ומכין שינוי דרך prepare_morning_action. כל ביצוע דורש אישור. אין כלי לכתובת שרירותית, להזרקת כותרות או לביצוע ישיר ללא אישור. שמות הפעולות והנתיבים בטבלה נשארים כפי שהם ב־API.

| פעולה | נתיב API | גישה |
| --- | --- | --- |
| <code dir="ltr">obtainAccessToken</code> | <code dir="ltr">POST /idp/v1/oauth/token</code> | אימות פנימי |
| <code dir="ltr">addDocument</code> | <code dir="ltr">POST /documents</code> | באישור: שינוי |
| <code dir="ltr">searchDocuments</code> | <code dir="ltr">POST /documents/search</code> | קריאה |
| <code dir="ltr">searchDocumentPayments</code> | <code dir="ltr">POST /documents/payments/search</code> | קריאה |
| <code dir="ltr">addPreviewDocument</code> | <code dir="ltr">POST /documents/preview</code> | קריאה |
| <code dir="ltr">getDocumentInformation</code> | <code dir="ltr">GET /documents/info</code> | קריאה |
| <code dir="ltr">getDocumentTemplates</code> | <code dir="ltr">GET /documents/templates</code> | קריאה |
| <code dir="ltr">getDocumentTypes</code> | <code dir="ltr">GET /documents/types</code> | קריאה |
| <code dir="ltr">getDocumentStatuses</code> | <code dir="ltr">GET /documents/statuses</code> | קריאה |
| <code dir="ltr">getDocument</code> | <code dir="ltr">GET /documents/{id}</code> | קריאה |
| <code dir="ltr">getLinkedDocuments</code> | <code dir="ltr">GET /documents/{id}/linked</code> | קריאה |
| <code dir="ltr">getDocumentDownloadLinks</code> | <code dir="ltr">GET /documents/{id}/download/links</code> | קריאה |
| <code dir="ltr">closeDocument</code> | <code dir="ltr">POST /documents/{id}/close</code> | באישור: שינוי |
| <code dir="ltr">openDocument</code> | <code dir="ltr">POST /documents/{id}/open</code> | באישור: שינוי |
| <code dir="ltr">addItem</code> | <code dir="ltr">POST /items</code> | באישור: שינוי |
| <code dir="ltr">getItem</code> | <code dir="ltr">GET /items/{id}</code> | קריאה |
| <code dir="ltr">updateItem</code> | <code dir="ltr">PUT /items/{id}</code> | באישור: שינוי |
| <code dir="ltr">deleteItem</code> | <code dir="ltr">DELETE /items/{id}</code> | באישור: מחיקה או איחוד |
| <code dir="ltr">searchItems</code> | <code dir="ltr">POST /items/search</code> | קריאה |
| <code dir="ltr">addClient</code> | <code dir="ltr">POST /clients</code> | באישור: שינוי |
| <code dir="ltr">getClient</code> | <code dir="ltr">GET /clients/{id}</code> | קריאה |
| <code dir="ltr">updateClient</code> | <code dir="ltr">PUT /clients/{id}</code> | באישור: שינוי |
| <code dir="ltr">deleteClient</code> | <code dir="ltr">DELETE /clients/{id}</code> | באישור: מחיקה או איחוד |
| <code dir="ltr">searchClients</code> | <code dir="ltr">POST /clients/search</code> | קריאה |
| <code dir="ltr">associateClientDocuments</code> | <code dir="ltr">POST /clients/{id}/assoc</code> | באישור: שינוי |
| <code dir="ltr">updateClientBalance</code> | <code dir="ltr">POST /clients/{id}/balance</code> | באישור: שינוי |
| <code dir="ltr">mergeClients</code> | <code dir="ltr">POST /clients/{id}/merge</code> | באישור: מחיקה או איחוד |
| <code dir="ltr">getPaymentForm</code> | <code dir="ltr">POST /payments/form</code> | באישור: בקשת תשלום |
| <code dir="ltr">searchCreditCardTokens</code> | <code dir="ltr">POST /payments/tokens/search</code> | קריאה |
| <code dir="ltr">chargeCreditCardToken</code> | <code dir="ltr">POST /payments/tokens/{id}/charge</code> | באישור: חיוב |
| <code dir="ltr">addSupplier</code> | <code dir="ltr">POST /suppliers</code> | באישור: שינוי |
| <code dir="ltr">getSupplier</code> | <code dir="ltr">GET /suppliers/{id}</code> | קריאה |
| <code dir="ltr">updateSupplier</code> | <code dir="ltr">PUT /suppliers/{id}</code> | באישור: שינוי |
| <code dir="ltr">deleteSupplier</code> | <code dir="ltr">DELETE /suppliers/{id}</code> | באישור: מחיקה או איחוד |
| <code dir="ltr">searchSuppliers</code> | <code dir="ltr">POST /suppliers/search</code> | קריאה |
| <code dir="ltr">mergeSuppliers</code> | <code dir="ltr">POST /suppliers/{id}/merge</code> | באישור: מחיקה או איחוד |
| <code dir="ltr">addExpense</code> | <code dir="ltr">POST /expenses</code> | באישור: שינוי |
| <code dir="ltr">searchExpenses</code> | <code dir="ltr">POST /expenses/search</code> | קריאה |
| <code dir="ltr">getExpense</code> | <code dir="ltr">GET /expenses/{id}</code> | קריאה |
| <code dir="ltr">updateExpense</code> | <code dir="ltr">PUT /expenses/{id}</code> | באישור: שינוי |
| <code dir="ltr">deleteExpense</code> | <code dir="ltr">DELETE /expenses/{id}</code> | באישור: מחיקה או איחוד |
| <code dir="ltr">getExpenseStatuses</code> | <code dir="ltr">GET /expenses/statuses</code> | קריאה |
| <code dir="ltr">closeExpense</code> | <code dir="ltr">POST /expenses/{id}/close</code> | באישור: שינוי |
| <code dir="ltr">openExpense</code> | <code dir="ltr">POST /expenses/{id}/open</code> | באישור: שינוי |
| <code dir="ltr">getExpenseFileUploadUrl</code> | <code dir="ltr">GET /file-upload/v1/url</code> | העלאת קובץ באישור |
| <code dir="ltr">uploadExpenseFile</code> | <code dir="ltr">POST /</code> | העלאת קובץ באישור |
| <code dir="ltr">searchExpenseDrafts</code> | <code dir="ltr">POST /expenses/drafts/search</code> | קריאה |
| <code dir="ltr">getSupportedBusinessCategories</code> | <code dir="ltr">GET /businesses/v1/occupations</code> | קריאה |
| <code dir="ltr">getSupportedCountries</code> | <code dir="ltr">GET /geo-location/v1/countries</code> | קריאה |
| <code dir="ltr">getSupportedCities</code> | <code dir="ltr">GET /geo-location/v1/cities</code> | קריאה |
| <code dir="ltr">getSupportedCurrencies</code> | <code dir="ltr">GET /currency-exchange/v1/latest</code> | קריאה |
| <code dir="ltr">getPartnerUsers</code> | <code dir="ltr">GET /partners/users</code> | דורש הרשאות שותף; לא נתמך |
| <code dir="ltr">requestUserApproval</code> | <code dir="ltr">POST /partners/users/connection</code> | דורש הרשאות שותף; לא נתמך |
| <code dir="ltr">disconnectPartnerUser</code> | <code dir="ltr">DELETE /partners/users/connection</code> | דורש הרשאות שותף; לא נתמך |


הכלי prepare_document מיועד לתהליך מסמכים בסיסי בשקלים. לשדות מתקדמים משתמשים ב־prepare_morning_action ובסכמה המתועדת. הפקת מסמך מחייבת תצוגת PDF ובדיקת נמענים. חיוב, מחיקה ואיחוד מחייבים גם אישור מוקלד. הבקשה נקשרת לסכמה, לתוכן, לסביבה ולחיבור המקומי.

האימות פנימי. שני שלבי העלאת הקובץ מבוצעים יחד רק לאחר אישור; הסוכן אינו מקבל פרטי העלאה חתומים. פעולות שותפים דורשות הרשאות שותף נפרדות ואינן נתמכות במפתח עסקי רגיל. אין פעולה מתועדת לסיום טיוטת הוצאה; קבלת Webhooks אינה ממומשת.

החיבור אישי דרך stdio, עם קבצים מקומיים ואישור דרך אפליקציית הסוכן. אין משתמשים, ארגונים או מסד נתונים משותף. סוכן שלא תומך בחלון אישור MCP אינו יכול לבצע שינויים. אפשר לחסום ביצוע נוסף עם MORNING_WRITES_ENABLED=false.

הכיסוי מתאר מימוש וסכמות. אימות חי של כל פעולה עדיין לא בוצע. הרשאות החשבון והבדיקות של מורנינג עדיין חלות. תאימות האישור וביצוע פעולות חיות עדיין לא נבדקו.

</div>
