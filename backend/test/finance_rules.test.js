import test from 'node:test';
import assert from 'node:assert/strict';
import {validCurrency,validBps,priceForBooking,splitInvoice,minorInt,walletAmounts,invoiceCode} from '../src/finance_rules.js';

test('Supported two-decimal currencies only, commission bounds',()=>{
  assert.equal(validCurrency('PKR'),true);assert.equal(validCurrency('USD'),true);
  assert.equal(validCurrency('JPY'),false);assert.equal(validCurrency('usd'),false);
  assert.equal(validBps(2000),true);assert.equal(validBps(5001),false);assert.equal(validBps(19.5),false);
});
test('30/60-minute quote rounds minor units half up',()=>{
  assert.deepEqual(priceForBooking('7.99',30,2000),{amount_minor:400,commission_bps:2000,commission_minor:80,tutor_minor:320});
  assert.deepEqual(priceForBooking('7.99',60,2000),{amount_minor:799,commission_bps:2000,commission_minor:160,tutor_minor:639});
  assert.deepEqual(priceForBooking('0.00',30,2000),{amount_minor:0,commission_bps:2000,commission_minor:0,tutor_minor:0});
});
test('Never accept scientific notation, negatives, more than 2 decimals or invalid duration',()=>{
  for(const v of ['1e3','-10','0.001','10x','NaN',null,''])assert.equal(priceForBooking(v,30,2000),null);
  assert.equal(priceForBooking('10.00',45,2000),null);
  assert.equal(priceForBooking('10.00',30,-1),null);
});
test('Commission split always sums to invoice gross',()=>{
  for(let amount=0;amount<1500;amount++){
    for(const bps of [0,750,2000,5000]){
      const split=splitInvoice(amount,bps);
      assert.equal(split.commission_minor+split.tutor_minor,amount);
      assert.ok(split.tutor_minor>=0);
    }
  }
});
test('Payout amount must be bounded positive integer and wallet accounts for reservations',()=>{
  for(const v of [0,-1,1.5,NaN,Infinity,'100',1e15])assert.equal(minorInt(v),null);
  assert.equal(minorInt(100),100);
  assert.deepEqual(walletAmounts('10000','2500'),{earned_minor:10000,reserved_minor:2500,available_minor:7500});
  assert.deepEqual(walletAmounts(2000,2001),{earned_minor:2000,reserved_minor:2001,available_minor:-1});
});
test('Stable invoice number',()=>{
  assert.equal(invoiceCode(42),'QA-00000042');
  assert.throws(()=>invoiceCode('hi'));
});
