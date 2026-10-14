// Integer minor-units only. All supported currencies have 2 decimal places.
export const supportedCurrencies=Object.freeze(['PKR','USD','GBP','EUR','AED','SAR']);
export function validCurrency(value){return supportedCurrencies.includes(value);}
export function validBps(value){return Number.isInteger(value)&&value>=0&&value<=5000;}
export function priceForBooking(hourlyRate,minutes,commissionBps=2000){
  if(![30,60].includes(minutes)||!validBps(commissionBps))return null;
  const raw=String(hourlyRate);
  if(!/^\d{1,6}(?:\.\d{1,2})?$/.test(raw))return null;
  const [whole,fraction='']=raw.split('.');
  const perHour=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(perHour)||perHour<0||perHour>9999900)return null;
  const amount_minor=Math.floor((perHour*minutes/60)+0.5);
  const commission_minor=Math.floor(amount_minor*commissionBps/10000+0.5);
  return {amount_minor,commission_bps:commissionBps,commission_minor,tutor_minor:amount_minor-commission_minor};
}
export function splitInvoice(amount,commissionBps){
  if(!Number.isSafeInteger(amount)||amount<0||amount>999999999||!validBps(commissionBps))return null;
  const commission_minor=Math.floor(amount*commissionBps/10000+0.5);
  return {commission_minor,tutor_minor:amount-commission_minor};
}
export function minorInt(value){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||value>999999999)return null;
  return value;
}
export function walletAmounts(credits,reserved){
  const c=Number(credits||0),r=Number(reserved||0);
  if(!Number.isSafeInteger(c)||!Number.isSafeInteger(r))return null;
  return {earned_minor:c,reserved_minor:r,available_minor:c-r};
}
export function invoiceCode(id){
  if(!/^\d+$/.test(String(id)))throw new Error('Invalid invoice ID');
  return `QA-${String(id).padStart(8,'0')}`;
}
