import { MATERIALS } from './education-library.mjs';
export const HANDOFF_SCHEMA='devfleet.education.handoff.v1';
// The handoff is assembled by trusted main code, only after an explicit student click.
// Never include chat transcripts or self-reported lab contents. Personal
// notebook text is included ONLY when the student explicitly opts in.
export function buildEducationHandoff(materialId,contexts=[],entries=[],{includeNotebook=false,linkedNotebookKey=null}={},currentMaterial=null){
  const material=currentMaterial?.id===materialId?currentMaterial:MATERIALS.find(m=>m.id===materialId);
  if(!material)throw Error('education_material_unknown');
  if(typeof includeNotebook!=='boolean'||(linkedNotebookKey!==null
    &&(typeof linkedNotebookKey!=='string'||!/^tab_[0-9a-f-]{36}$/i.test(linkedNotebookKey))))
    throw Error('education_handoff_options_invalid');
  const depth=material.depth;
  const context=contexts.find(c=>c.subject===material.subject);
  const safeCount=n=>Number.isInteger(n)&&n>=0&&n<=100000?n:0;
  const fields=[
    'УЧЕБНЫЙ ДИАЛОГ С GPT — СТАРТ ТОЛЬКО ПО МОЕЙ КОМАНДЕ',
    'Предмет №'+String(material.subject).padStart(2,'0')+' | Тема: '+material.title,
    'Цель обучения: '+depth.objective,
    'ИЗУЧАЕМЫЙ МАТЕРИАЛ (его факты независимо перепроверь): '+material.theory,
    'УГЛУБЛЁННЫЙ КОНТЕКСТ: '+depth.extension,
    ...(depth.spotlight?['УГЛУБЛЁННЫЙ РАЗБОР: '+depth.spotlight.text]:[]),
    'СЛОВАРЬ ТЕРМИНОВ:\n'+depth.glossary.map(x=>x.term+' — '+x.meaning).join('\n'),
    'РАЗОБРАТЬ НА ПРИМЕРЕ: '+material.example,
    'ПРАКТИЧЕСКОЕ ЗАДАНИЕ: '+material.exercise,
    'КОНТРОЛЬНЫЙ ВОПРОС: '+material.check,
    'РАСПРОСТРАНЁННАЯ ОШИБКА: '+depth.commonMistake,
    'ПРОВЕРОЧНАЯ РЕФЛЕКСИЯ: '+depth.reflection,
    'ИСТОЧНИКИ ДЛЯ ПЕРЕПРОВЕРКИ:\n'+depth.references.map(x=>x.title+' — '+x.url).join('\n'),
    ...(includeNotebook?['МОЯ ЛИЧНАЯ ТЕТРАДЬ (данные передаю тебе сознательно; независимо проверяй):\\n'+
      entries.filter(e=>e.notebook_key===materialId||e.notebook_key===linkedNotebookKey).slice(-8)
        .map(e=>e.title+': '+e.body.slice(0,360)).join('\\n')]:[]),
    'Локальные результаты проверенных ответов по дисциплине: '+
      safeCount(context?.distinct_correct_answers)+' из '+safeCount(context?.practice_questions)+
      '; попыток '+safeCount(context?.attempts)+'. '+
      'Самоотчёты о лабораторной работе ('+safeCount(context?.self_reported_labs)+') НЕ проверены.',
    'ПОРЯДОК ОБУЧЕНИЯ: Начни с определения незнакомых терминов, проверь мои предварительные знания. '+
      'Затем подробно объясни физический смысл с примерами, пошаговым расчётом или схемой. '+
      'Задавай вопросы по одному, ожидай моего ответа и разбирай ошибки. '+
      'Предлагай проверенные источники, отдельно помечай допущения и ошибки конспекта. '+
      'Никогда не объявляй навык освоенным только на основании текста, одного теста или самоотчёта. '+
      'Не предлагай опасные эксперименты с сетью 230 В, высотой и активным неизвестным оптическим портом.',
    'Важно: Этот текст подготовлен локально; я самостоятельно вставляю и отправляю его в ChatGPT.'
  ];
  const text=fields.join('\n\n');
  if(text.length>16000)throw Error('education_handoff_too_large');
  return {schema:HANDOFF_SCHEMA,material_id:material.id,text,
    character_count:text.length,includes_private_notes:includeNotebook,sends_automatically:false};
}
