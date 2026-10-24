// E5: Immutable, deterministic and reviewable offline seed content.
// Material threads are NOT ChatGPT conversations; an owned ChatGPT tab is created
// only when the student explicitly asks to discuss a material.
import { TOPICS_A } from './education-library-a.mjs';
import { TOPICS_B } from './education-library-b.mjs';
import { TOPICS_C } from './education-library-c.mjs';
import { lessonDepth } from './education-lesson-depth.mjs';
export const MATERIAL_SCHEMA='devfleet.education.materials.v1';
const data=[...TOPICS_A,...TOPICS_B,...TOPICS_C];
const ids=new Set(),subjects=new Set();
const result=[];
for(const [subject,topics] of data){
  if(!Number.isInteger(subject)||subject<0||subject>14||subjects.has(subject)||
    !Array.isArray(topics)||topics.length!==8)throw Error('education_material_group_invalid');
  subjects.add(subject);
  topics.forEach((entry,i)=>{
    if(!Array.isArray(entry)||entry.length!==5||entry.some(
      (x,index)=>typeof x!=='string'||x.trim().length<(index===0?4:14)||x.length>1600))
      throw Error('education_material_content_invalid');
    const id='material-'+String(subject).padStart(2,'0')+'-'+String(i+1).padStart(2,'0');
    if(ids.has(id))throw Error('education_material_duplicate');
    ids.add(id);
    const [title,theory,example,exercise,check]=entry;
    result.push(Object.freeze({id,subject,position:i+1,title,theory,example,exercise,check,
      origin:MATERIAL_SCHEMA,depth:lessonDepth({id,subject}),
      assistant_status:'curated_study_material_not_gpt',
      read_only:true}));
  });
}
if(subjects.size!==15||result.length!==120)throw Error('education_material_catalog_incomplete');
export const MATERIALS=Object.freeze(result);
export function discussionPrompt(material){
  if(!material||!MATERIALS.some(m=>m.id===material.id))throw Error('education_material_unknown');
  return [
    'Ты мой преподаватель по направлению технической связи и ВОЛС. Я изучаю предмет с нуля.',
    'Тема: '+material.title+'.',
    'Изученный исходный материал: '+material.theory,
    'Практический пример: '+material.example,
    'Самостоятельная задача: '+material.exercise,
    'Контрольный вопрос: '+material.check,
    'Используй исходный материал как учебный конспект, но независимо перепроверяй техническую точность.',
    'Подробно объясни все термины простыми словами, предложи иллюстрацию, покажи дополнительный пример.',
    'Задавай проверочные вопросы по одному и не раскрывай решения до моей попытки. Не объявляй меня специалистом по одному уроку.',
    'Практические задания на оборудование предлагай только с безопасными ограничениями; не предлагай работу на сетевом напряжении или активном неизвестном оптическом порту.'
  ].join('\n\n');
}
