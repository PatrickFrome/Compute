// E4: bounded deterministic spaced-review policy. These are practice cards,
// not certification or proof of practical competence.
export const REVIEW_INTERVAL_DAYS=Object.freeze([1,3,7,14,30,60]);
const iso=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value))
  &&new Date(value).toISOString()===value;
export function nextReview(previous,passed,at){
  if(!iso(at)||typeof passed!=='boolean')throw Error('education_review_invalid');
  const oldStep=previous?.step||0;
  if(!passed)return {step:0,due_at:at,passed:false};
  // Early right answers are practice, not a way to fast-forward spaced reviews.
  if(previous?.passed&&previous?.due_at>at)
    return {step:oldStep,due_at:previous.due_at,passed:true};
  const step=Math.min(oldStep+1,REVIEW_INTERVAL_DAYS.length);
  const due_at=new Date(Date.parse(at)+REVIEW_INTERVAL_DAYS[step-1]*86400000).toISOString();
  return {step,due_at,passed:true};
}
export function summarizeReviews(reviews,questions,now){
  if(!iso(now))throw Error('education_clock_invalid');
  const known=new Set(questions.map(q=>q.id));
  const pending=reviews.filter(r=>known.has(r.question_id)&&r.due_at<=now)
    .sort((a,b)=>a.due_at.localeCompare(b.due_at)||a.question_id.localeCompare(b.question_id));
  return {
    due:pending.map(r=>({question_id:r.question_id,step:r.step,due_at:r.due_at})),
    due_count:pending.length,
    scheduled_count:reviews.filter(r=>known.has(r.question_id)&&r.due_at>now).length,
    untouched_count:questions.filter(q=>!reviews.some(r=>r.question_id===q.id)).length
  };
}
export function publicStudyContext({questions,attempts,reviews,labs,lessons},subject,now=new Date().toISOString()){
  if(!Number.isInteger(subject)||subject<0||subject>14)
    throw Error('education_subject_invalid');
  const selected=questions.filter(q=>q.subject===subject);
  const qids=new Set(selected.map(q=>q.id));
  const done=attempts.filter(a=>qids.has(a.question_id));
  const answeredCorrectly=new Set(done.filter(a=>a.passed).map(a=>a.question_id));
  const lessonIds=new Set(lessons.filter(l=>l.subject===subject).map(l=>l.id));
  const selfReports=labs.filter(l=>lessonIds.has(l.lesson_id)).length;
  return {
    subject,practice_questions:selected.length,
    distinct_correct_answers:answeredCorrectly.size,
    attempts:done.length,
    review_due:reviews.filter(r=>qids.has(r.question_id)&&r.due_at<=now).length,
    self_reported_labs:selfReports,
    caveat:'Only local fixed-answer practice was automatically checked. Self-reported practical work is unverified. No proof of professional competence.'
  };
}
