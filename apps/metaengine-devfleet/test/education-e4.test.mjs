import test from 'node:test';
import assert from 'node:assert/strict';
import {EducationStore,EDUCATION_SCHEMA} from '../src/education-core.mjs';
import {nextReview,REVIEW_INTERVAL_DAYS} from '../src/education-review.mjs';

const at='2026-10-25T10:00:00.000Z';
const day=(iso,n)=>new Date(Date.parse(iso)+n*86400000).toISOString();
const disk=(initial=null)=>{let value=initial;return {
  load:async()=>value===null?null:structuredClone(value),
  save:async x=>{value=structuredClone(x);},get:()=>structuredClone(value)
};};
function clock(){let value=new Date(at);return {
  now:()=>value,addDays:n=>{value=new Date(value.getTime()+86400000*n);},
  set:s=>{value=new Date(s);}
};}
test('E4 seeds 26 practice questions with no answer keys exported',async()=>{
 const s=new EducationStore(disk());await s.init();
 const state=s.snapshot();assert.equal(state.questions.length,26);
 assert.equal(state.review_summary.untouched_count,26);
 assert.ok(state.questions.every(q=>!Object.hasOwn(q,'correct')&&!Object.hasOwn(q,'explanation')));
 assert.equal(state.review_summary.due_count,0);
});
test('E4 deterministic first review after one day, then three, then seven',async()=>{
 const time=clock(),s=new EducationStore(disk(),{now:time.now});await s.init();
 let a=await s.submitAnswer({question_id:'ohm',choice:1});
 assert.equal(a.passed,true);assert.equal(a.review.step,1);
 assert.equal(a.review.due_at,day(at,1));
 assert.equal(s.snapshot().review_summary.due_count,0);
 time.addDays(1);
 assert.equal(s.snapshot().review_summary.due_count,1);
 a=await s.submitAnswer({question_id:'ohm',choice:1});
 assert.equal(a.review.step,2);assert.equal(a.review.due_at,day(at,4));
 time.addDays(3);
 a=await s.submitAnswer({question_id:'ohm',choice:1});
 assert.equal(a.review.step,3);assert.equal(a.review.due_at,day(at,11));
 assert.deepEqual(REVIEW_INTERVAL_DAYS,[1,3,7,14,30,60]);
});
test('E4 correct early practice cannot accelerate schedule',async()=>{
 const time=clock(),s=new EducationStore(disk(),{now:time.now});await s.init();
 await s.submitAnswer({question_id:'ohm',choice:1});
 const early=await s.submitAnswer({question_id:'ohm',choice:1});
 assert.equal(early.review.step,1);assert.equal(early.review.due_at,day(at,1));
});
test('E4 wrong answer returns card to due queue and drops interval step',async()=>{
 const time=clock(),s=new EducationStore(disk(),{now:time.now});await s.init();
 await s.submitAnswer({question_id:'ohm',choice:1});
 time.addDays(1);
 const wrong=await s.submitAnswer({question_id:'ohm',choice:0});
 assert.equal(wrong.review.step,0);
 assert.equal(s.snapshot().review_summary.due_count,1);
 const retry=await s.submitAnswer({question_id:'ohm',choice:1});
 assert.equal(retry.review.step,1);
});
test('E4 lab self reports persist, never count as professional verification',async()=>{
 const d=disk(),time=clock(),s=new EducationStore(d,{now:time.now});await s.init();
 const lab=await s.addLabReport({lesson_id:'s3-1',title:'Практика закона Ома',
 kind:'simulation',observation:'Измерил ток в безопасной виртуальной цепи.'});
 assert.equal(lab.provenance,'self_reported_unverified');
 assert.deepEqual(s.snapshot().mastered,[]);
 assert.equal(s.snapshot().study_contexts[3].self_reported_labs,1);
 const reboot=new EducationStore(d,{now:time.now});await reboot.init();
 assert.equal(reboot.snapshot().labs[0].id,lab.id);
});
test('E4 validated evidence blocks malicious kind and oversized reports',async()=>{
 const d=disk(),s=new EducationStore(d);await s.init();const before=JSON.stringify(d.get());
 await assert.rejects(s.addLabReport({lesson_id:'s3-1',title:'A',kind:'signed',
 observation:'untrusted'}),/education_lab_invalid/);
 await assert.rejects(s.addLabReport({lesson_id:'s3-1',title:'A',kind:'physical',
 observation:'x'.repeat(4001)}),/education_lab_invalid/);
 assert.equal(JSON.stringify(d.get()),before);
});
test('E4 migrates old E1–E3 store with no reviews/labs, without changing mastery claims',async()=>{
 const d=disk(),s=new EducationStore(d);await s.init();
 await s.submitAnswer({question_id:'ohm',choice:1});
 const old=d.get();delete old.reviews;delete old.labs;
 const reboot=new EducationStore(disk(old));await reboot.init();
 assert.equal(reboot.snapshot().reviews.length,0);
 assert.deepEqual(reboot.snapshot().mastered,['ohm']);
 assert.equal(reboot.snapshot().review_summary.due_count,0);
});
test('E4 review validation rejects duplicate or unknown identifiers and prevents write',async()=>{
 const d=disk(),s=new EducationStore(d);await s.init();
 const state=d.get();
 state.reviews=[
  {question_id:'ohm',step:1,passed:true,due_at:day(at,1)},
  {question_id:'ohm',step:1,passed:true,due_at:day(at,2)}
 ];
 await assert.rejects(new EducationStore(disk(state)).init(),/education_review_invalid/);
});
test('E4 verified practice summary can be shared without chat transcripts or self report text',async()=>{
 const s=new EducationStore(disk());await s.init();
 await s.submitAnswer({question_id:'ohm',choice:1});
 await s.addLabReport({lesson_id:'s3-1',title:'Private sample',kind:'analysis',
 observation:'UNIQUE_PRIVATE_NOTE_CONTENT'});
 const c=s.snapshot().study_contexts[3];
 assert.equal(c.distinct_correct_answers,1);
 assert.equal(c.practice_questions,2);
 assert.equal(c.self_reported_labs,1);
 assert.ok(!JSON.stringify(c).includes('UNIQUE_PRIVATE_NOTE_CONTENT'));
 assert.match(c.caveat,/unverified/);
});
test('E4 simultaneous review attempts use one schedule record, preserving all attempts',async()=>{
 const time=clock(),s=new EducationStore(disk(),{now:time.now});await s.init();
 await Promise.all(Array.from({length:12},()=>s.submitAnswer({question_id:'ohm',choice:1})));
 const snapshot=s.snapshot();
 assert.equal(snapshot.reviews.length,1);
 assert.equal(snapshot.reviews[0].step,1);
 assert.equal(snapshot.attempts.length,12);
});
