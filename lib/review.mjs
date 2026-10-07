const names={addDocument:'הפקת מסמך במורנינג',closeDocument:'סגירת מסמך',openDocument:'פתיחת מסמך',addItem:'יצירת פריט',updateItem:'עדכון פריט',deleteItem:'מחיקת פריט',addClient:'יצירת לקוח',updateClient:'עדכון לקוח',deleteClient:'מחיקת לקוח',associateClientDocuments:'שיוך מסמכים ללקוח',updateClientBalance:'עדכון יתרת לקוח',mergeClients:'איחוד לקוחות',getPaymentForm:'יצירת בקשת תשלום',chargeCreditCardToken:'חיוב כרטיס אשראי',addSupplier:'יצירת ספק',updateSupplier:'עדכון ספק',deleteSupplier:'מחיקת ספק',mergeSuppliers:'איחוד ספקים',addExpense:'רישום הוצאה',updateExpense:'עדכון הוצאה',deleteExpense:'מחיקת הוצאה',closeExpense:'סגירת הוצאה',openExpense:'פתיחת הוצאה',createDocumentDraft:'שמירת טיוטה במורנינג',updateDocumentDraft:'עדכון טיוטה במורנינג',deleteDocumentDraft:'מחיקת טיוטה במורנינג',duplicateDocumentDraft:'שכפול טיוטה במורנינג'};
const labels={description:'תיאור',name:'שם',amount:'סכום',currency:'מטבע',date:'תאריך',dueDate:'מועד תשלום',client:'לקוח',supplier:'ספק',emails:'נמענים',income:'פריטים',payment:'תשלומים',quantity:'כמות',price:'מחיר יחידה',vat:'מע״מ',vatRate:'שיעור מע״מ',vatType:'סוג מע״מ',remarks:'הערות',footer:'טקסט תחתון',emailContent:'תוכן המייל',type:'סוג מסמך',documentType:'סוג מסמך',lang:'שפה',discount:'הנחה',rounding:'עיגול',signed:'חתימה דיגיטלית',attachment:'צירוף מסמך למייל',taxId:'מספר עוסק',address:'כתובת',city:'עיר',zip:'מיקוד',country:'מדינה',phone:'טלפון',mobile:'נייד',fax:'פקס',contactPerson:'איש קשר',active:'פעיל',send:'שליחה',department:'מחלקה',accountingKey:'מפתח הנהלת חשבונות',paymentTerms:'תנאי תשלום',bankName:'בנק',bankBranch:'סניף',bankAccount:'חשבון בנק',balance:'יתרה',balanceAmount:'יתרה',labels:'תגיות',category:'קטגוריה',subCategory:'תת קטגוריה',number:'מספר מסמך',reportingDate:'תאריך דיווח',paymentType:'סוג תשלום',currencyRate:'שער המרה',allocationNumber:'מספר הקצאה',pcnClassification:'סיווג PCN',accountingClassification:'סיווג חשבונאי',maxPayments:'מספר תשלומים מרבי',paymentRequestData:'פרטי בקשת תשלום',successUrl:'כתובת לאחר הצלחה',failureUrl:'כתובת לאחר כישלון',notifyUrl:'כתובת עדכון',custom:'מידע נוסף',group:'קבוצה',add:'יצירת לקוח חדש',self:'חשבונית עצמית',catalogNum:'מספר קטלוגי',linkType:'סוג קישור',linkedDocumentIds:'מסמכים מקושרים',linkedPaymentId:'תשלום מקושר',mergeId:'יעד לאיחוד',id:'מזהה',ids:'מסמכים',itemId:'מזהה פריט',draftId:'טיוטה שמורה',pluginId:'מזהה ספק סליקה'};
const documentTypes={10:'הצעת מחיר',100:'הזמנה',200:'תעודת משלוח',300:'חשבון עסקה',305:'חשבונית מס',320:'חשבונית מס / קבלה',330:'חשבונית זיכוי',400:'קבלה',405:'קבלה על תרומה',410:'קבלה על פיקדון'};
const text=value=>String(value).replace(/[\x00-\x1f\x7f]/g,' ');
const valueText=value=>typeof value==='boolean'?(value?'כן':'לא'):value===null?'ריק':text(value);
export function reviewText(d){
 const p=d.payload,b=p.body??{},target=p.before?.doc??p.before?.primary??p.before??{};
 const lines=[names[p.operationId]??(d.kind==='expense_upload'?'העלאת קובץ הוצאה':'פעולה במורנינג')];
 if(d.environment==='sandbox')lines.push('סביבה: בדיקה');
 if(d.kind==='expense_upload'){
  lines.push(`קובץ: ${text(p.fileName)}`,`גודל: ${(p.size/1024/1024).toFixed(2)} MB`,p.expenseId?'הקובץ יצורף להוצאה קיימת.':'מורנינג תיצור טיוטת הוצאה לסקירה והשלמה.');
 }else{
  if(target.name)lines.push(`יעד: ${text(target.name)}`);
  if(target.client?.name)lines.push(`לקוח: ${text(target.client.name)}`);
  if(target.description)lines.push(`תיאור קיים: ${text(target.description)}`);
  if(target.type!==undefined)lines.push(`מסמך: ${documentTypes[target.type]??text(target.type)}`);
  if(target.number!==undefined)lines.push(`מספר מסמך: ${text(target.number)}`);
  if(target.amount!==undefined)lines.push(`סכום קיים: ${text(target.amount)} ${text(target.currency??'')}`.trim());
  if(p.before?.secondary?.name)lines.push(`יעד לאיחוד: ${text(p.before.secondary.name)}`);
  if(!Object.keys(target).length&&p.parameters?.id)lines.push(`יעד: ${text(p.parameters.id)}`);
  function fields(value,prefix='',key=''){
   if(/token|secret|password|cvv|cardNumber/i.test(key)){lines.push(`${prefix}: פרטי תשלום מוסתרים`);return;}
   if(value===undefined)return;
   if(Array.isArray(value)){
    if(!value.length)lines.push(`${prefix}: ללא`);
    else for(let i=0;i<value.length;i++)fields(value[i],`${prefix} ${i+1}`,key);
   }else if(value&&typeof value==='object'){
    for(const [k,v] of Object.entries(value)){
     if(k==='draftId'||k==='id'&&value.name)continue;
     fields(v,[prefix,labels[k]??text(k)].filter(Boolean).join(' / '),k);
    }
   }else lines.push(`${prefix}: ${key==='type'&&documentTypes[value]?documentTypes[value]:valueText(value)}`);
  }
  fields(b);
 }
 if(p.operationId==='addDocument')lines.push(b.client?.emails?.length?`המסמך יופק ויישלח אל: ${b.client.emails.map(text).join(', ')}`:'המסמך יופק ללא שליחה במייל.','בדקו את תצוגת ה־PDF לפני ההפקה.');
 if(p.risk==='charge')lines.push('הפעולה תחייב את כרטיס האשראי.');
 if(p.risk==='destructive')lines.push('הפעולה תמחק או תאחד את הרשומה במורנינג.');
 if(lines.join('\n').length>40000)throw new Error('Request is too large for a readable review. Prepare a smaller request.');
 return lines.join('\n');
}
