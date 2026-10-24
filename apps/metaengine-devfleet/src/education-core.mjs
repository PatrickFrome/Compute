import crypto from 'node:crypto';
import { LESSONS, CURRICULUM_VERSION } from './curriculum.mjs';
import { nextReview, summarizeReviews, publicStudyContext } from './education-review.mjs';

export const EDUCATION_SCHEMA='metaengine.devfleet.education.v1';
export const SUBJECTS=[
  '00 Учебный центр и методист','01 Техническая математика','02 Основы физики',
  '03 Электротехника','04 Аналоговая электроника','05 Цифровая электроника',
  '06 Сигналы и системы связи','07 Компьютерные сети',
  '08 Физическая оптика и фотоника','09 Оптические кабели и компоненты',
  '10 Сварка и монтаж ВОЛС','11 Измерения и диагностика',
  '12 GPON, FTTH и транспортные сети','13 Охрана труда и нормы',
  '14 Практические проекты и экзамены'
];
const BANK=Object.freeze([
  {id:'math-units',subject:1,title:'Приставки единиц',question:'Сколько миллиампер в одном ампере?',choices:['10','100','1000'],correct:2,explanation:'Милли- означает одну тысячную основной единицы.'},
  {id:'physics-light',subject:2,title:'Основы оптики',question:'Что переносит информацию внутри оптического волокна?',choices:['Свет','Постоянный электрический ток','Поток воздуха'],correct:0,explanation:'Информация кодируется изменениями оптического излучения.'},
  {id:'ohm',subject:3,title:'Закон Ома',question:'Каков ток через резистор 6 Ом при напряжении 12 В?',choices:['0,5 А','2 А','72 А'],correct:1,explanation:'I = U / R = 12 / 6 = 2 А.'},
  {id:'diode',subject:4,title:'Полупроводники',question:'Какова основная функция обычного диода?',choices:['Накапливать заряд','Пропускать ток преимущественно в одном направлении','Измерять напряжение'],correct:1,explanation:'Диод обладает выраженной односторонней проводимостью.'},
  {id:'binary',subject:5,title:'Двоичная система',question:'Чему равно двоичное число 101 в десятичной системе?',choices:['3','5','7'],correct:1,explanation:'1×4 + 0×2 + 1×1 = 5.'},
  {id:'attenuation',subject:6,title:'Затухание',question:'Что означает положительная величина оптических потерь в дБ?',choices:['Уменьшение мощности','Увеличение частоты','Ускорение распространения света'],correct:0,explanation:'Потери показывают, насколько уменьшилась мощность сигнала.'},
  {id:'ipv4',subject:7,title:'IP-адресация',question:'Какую задачу решает IP-адрес в сети?',choices:['Однозначно задаёт сопротивление кабеля','Адресует сетевой интерфейс для передачи пакетов','Измеряет оптическую мощность'],correct:1,explanation:'IP-адрес используется для сетевой адресации и маршрутизации пакетов.'},
  {id:'cladding',subject:8,title:'Строение волокна',question:'Как называется стеклянный слой вокруг сердцевины волокна?',choices:['Оболочка (cladding)','КДЗС','Экран витой пары'],correct:0,explanation:'Стеклянная оболочка окружает сердцевину и участвует в удержании оптического сигнала.'},
  {id:'connector',subject:9,title:'Соединения',question:'Что следует проверить перед подключением оптического коннектора?',choices:['Чистоту торца','Цвет корпуса компьютера','Номер этажа'],correct:0,explanation:'Загрязнение торца может вызвать серьёзные потери и повреждения.'},
  {id:'splice',subject:10,title:'Технология сварки',question:'Какой инструмент формирует подготовленный торец стеклянного волокна?',choices:['Скалыватель','Мультиметр','Коммутатор'],correct:0,explanation:'Прецизионный скалыватель формирует торец волокна перед сваркой.'},
  {id:'otdr',subject:11,title:'Рефлектометрия',question:'Что позволяет определить OTDR?',choices:['Мощность блока питания','Положение событий вдоль оптической линии','MAC-адрес маршрутизатора'],correct:1,explanation:'OTDR анализирует обратное рассеяние и отражения вдоль волокна.'},
  {id:'pon',subject:12,title:'PON',question:'Для чего в пассивной оптической сети применяется сплиттер?',choices:['Для распределения оптической мощности','Для преобразования в медный кабель','Для зарядки аккумулятора'],correct:0,explanation:'Сплиттер пассивно распределяет оптическую мощность между направлениями.'},
  {id:'safety',subject:13,title:'Оптическая безопасность',question:'Можно ли смотреть в торец неизвестного оптического волокна?',choices:['Да, если не видно света','Нет','Да, через лупу'],correct:1,explanation:'Волокно может переносить невидимое опасное оптическое излучение.'},
  {"id":"math-convert","subject":1,"title":"Единицы","question":"Сколько микрометров содержится в одном миллиметре?","choices":["10","1000","1000000"],"correct":1,"explanation":"1 мм = 1000 мкм."},
  {"id":"physics-frequency","subject":2,"title":"Колебания","question":"Какая единица измеряет частоту?","choices":["Герц","Ом","Ватт"],"correct":0,"explanation":"Герц — число периодов в секунду."},
  {"id":"power","subject":3,"title":"Мощность","question":"Мощность резистора при U=5 В и I=0,2 А равна:","choices":["1 Вт","25 Вт","0,04 Вт"],"correct":0,"explanation":"P=UI=5×0,2=1 Вт."},
  {"id":"capacitor","subject":4,"title":"Элементы","question":"Что в электрической цепи накапливает заряд?","choices":["Плавкий предохранитель","Конденсатор","Диод"],"correct":1,"explanation":"Конденсатор хранит заряд и энергию электрического поля."},
  {"id":"logic-and","subject":5,"title":"Логика","question":"Когда на выходе логического AND будет 1?","choices":["Хотя бы один вход 1","Оба входа 0","Все входы 1"],"correct":2,"explanation":"AND=1 только когда все входы равны 1."},
  {"id":"db-power","subject":6,"title":"Уровень сигнала","question":"Разница между дБ и дБм заключается в том, что:","choices":["дБм — абсолютный уровень относительно 1 мВт","дБм измеряет расстояние","дБ всегда температура"],"correct":0,"explanation":"дБ — отношение, дБм — уровень относительно 1 мВт."},
  {"id":"ethernet-switch","subject":7,"title":"Ethernet","question":"Коммутатор Ethernet обычно пересылает кадры с учётом:","choices":["MAC-адресов","Напряжения батареи","Показателя преломления"],"correct":0,"explanation":"Коммутаторы второго уровня используют MAC-адреса."},
  {"id":"fiber-cladding","subject":8,"title":"Показатели преломления","question":"В стандартном ступенчатом волокне показатель преломления сердцевины обычно:","choices":["Выше оболочки","Равен нулю","Ниже оболочки"],"correct":0,"explanation":"Для направляемого распространения показатель сердцевины выше."},
  {"id":"g657","subject":9,"title":"Семейства волокон","question":"Для чего особенно полезны волокна G.657?","choices":["Снижения чувствительности к изгибным потерям","Передачи электроэнергии","Усиления радиосигналов"],"correct":0,"explanation":"G.657 описывает изгибоустойчивые одномодовые волокна."},
  {"id":"sleeve","subject":10,"title":"Защита сварки","question":"Для чего после сварки применяют КДЗС?","choices":["Для защиты сростка","Для изменения длины волны","Для усиления света"],"correct":0,"explanation":"КДЗС обеспечивает механическую защиту соединения."},
  {"id":"olts","subject":11,"title":"Измерения","question":"Какой набор измеряет сквозное затухание оптической линии?","choices":["OLTS","Обычный омметр","Спутниковый компас"],"correct":0,"explanation":"OLTS использует стабильный источник и измеритель оптической мощности."},
  {"id":"olt","subject":12,"title":"Доступ","question":"Оборудование OLT в PON обычно размещается:","choices":["Со стороны оператора","В каждом коннекторе","В сварочном аппарате"],"correct":0,"explanation":"OLT — головное оборудование пассивной оптической сети."},
  {"id":"glass","subject":13,"title":"Безопасность","question":"Куда складывать обрезки стеклянного волокна?","choices":["В закрытый контейнер для острых отходов","В карман","На рабочую поверхность"],"correct":0,"explanation":"Острые микроскопические стеклянные осколки собирают в закрытый контейнер."}
]);
const snapshot=value=>structuredClone(value);
const validId=value=>typeof value==='string'&&/^[a-z0-9-]{1,80}$/i.test(value);
const validTabId=value=>typeof value==='string'&&/^tab_[0-9a-f-]{36}$/i.test(value);
const title=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=100?value.trim():null;
function freshState(){
  return {schema:EDUCATION_SCHEMA,folders:SUBJECTS.map((name,index)=>({
    id:'subject-'+index,parent_id:null,title:name,order:index
  })),chats:[],attempts:[],notes:[],reviews:[],labs:[],created_at:new Date().toISOString()};
}
function check(state){
  if(state&&state.notes===undefined)state.notes=[];
  if(state&&state.reviews===undefined)state.reviews=[];
  if(state&&state.labs===undefined)state.labs=[];
  if(!state||state.schema!==EDUCATION_SCHEMA||!Array.isArray(state.notes)||!Array.isArray(state.reviews)||!Array.isArray(state.labs)||!Array.isArray(state.folders)
    ||!Array.isArray(state.chats)||!Array.isArray(state.attempts))throw Error('education_state_invalid');
  if(state.folders.length>500||state.chats.length>1000||state.attempts.length>10000||state.notes.length>1500||state.labs.length>500||state.reviews.length>100)
    throw Error('education_state_capacity_exceeded');
  const ids=new Set();
  for(const f of state.folders){
    if(!validId(f.id)||ids.has(f.id)||!title(f.title))throw Error('education_folder_invalid');
    ids.add(f.id);
  }
  for(const f of state.folders){
    let p=f.parent_id,seen=new Set([f.id]);
    while(p!==null){if(!ids.has(p)||seen.has(p))throw Error('education_folder_cycle');
      seen.add(p);p=state.folders.find(x=>x.id===p).parent_id;}
  }
  const chatIds=new Set(),tabIds=new Set();
  for(const c of state.chats){
    if(!validId(c.id)||chatIds.has(c.id)||tabIds.has(c.tab_id)
      ||!ids.has(c.folder_id)||!validTabId(c.tab_id)||!title(c.title))
      throw Error('education_chat_invalid');
    chatIds.add(c.id);tabIds.add(c.tab_id);
  }
  const knownLessons=new Set(LESSONS.map(l=>l.id));
  for(const note of state.notes){
    if(!validId(note.id)||!knownLessons.has(note.lesson_id)
      ||typeof note.text!=='string'||note.text.length<1||note.text.length>4000)
      throw Error('education_note_invalid');
  }
  const qids=new Set(BANK.map(q=>q.id)),usedReviews=new Set();
  for(const r of state.reviews){
    if(!r||!qids.has(r.question_id)||usedReviews.has(r.question_id)
      ||!Number.isInteger(r.step)||r.step<0||r.step>6
      ||typeof r.passed!=='boolean'||typeof r.due_at!=='string'
      ||Number.isNaN(Date.parse(r.due_at))||new Date(r.due_at).toISOString()!==r.due_at)
      throw Error('education_review_invalid');
    usedReviews.add(r.question_id);
  }
  const seenLabs=new Set();
  for(const lab of state.labs){
    if(!lab||!validId(lab.id)||seenLabs.has(lab.id)||!knownLessons.has(lab.lesson_id)
      ||!title(lab.title)||typeof lab.observation!=='string'
      ||lab.observation.trim().length<1||lab.observation.length>4000
      ||!['simulation','physical','analysis'].includes(lab.kind)
      ||lab.provenance!=='self_reported_unverified')throw Error('education_lab_invalid');
    seenLabs.add(lab.id);
  }
  return state;
}
export class EducationStore{
  #disk;#state;#serial=Promise.resolve();
  #now;
  constructor(disk,{now=()=>new Date()}={}){this.#disk=disk;this.#now=now;}
  async init(){const saved=await this.#disk.load();this.#state=check(saved??freshState());
    if(!saved)await this.#disk.save(this.#state);return this.snapshot();}
  snapshot(){if(!this.#state)throw Error('education_not_initialized');
    const now=this.#now().toISOString();
    return snapshot({
      ...this.#state,curriculum_version:CURRICULUM_VERSION,lessons:LESSONS,
      questions:BANK.map(({correct,explanation,...q})=>q),
      mastered:[...new Set(this.#state.attempts.filter(a=>a.passed).map(a=>a.question_id))],
      review_summary:summarizeReviews(this.#state.reviews,BANK,now),
      study_contexts:SUBJECTS.map((_,subject)=>publicStudyContext({
        ...this.#state,questions:BANK,lessons:LESSONS
      },subject,now))
    });
  }
  #change(mutator){
    const execute=async()=>{const state=snapshot(this.#state);const result=mutator(state);
      check(state);await this.#disk.save(state);this.#state=state;return result;};
    const pending=this.#serial.then(execute);this.#serial=pending.catch(()=>{});return pending;
  }
  addFolder({parent_id=null,title:label}={}){
    return this.#change(s=>{if(!title(label))throw Error('education_title_invalid');
      if(parent_id!==null&&!s.folders.some(f=>f.id===parent_id))throw Error('education_parent_not_found');
      const folder={id:crypto.randomUUID(),parent_id,title:title(label),order:s.folders.length};
      s.folders.push(folder);return snapshot(folder);});
  }
  renameFolder({folder_id,title:label}={}){
    return this.#change(s=>{const folder=s.folders.find(f=>f.id===folder_id);
      if(!folder||!title(label))throw Error('education_folder_or_title_invalid');
      folder.title=title(label);return snapshot(folder);});
  }
  bindChat({folder_id,tab_id,title:label}={},liveTabs=[]){
    return this.#change(s=>{if(!s.folders.some(f=>f.id===folder_id))throw Error('education_folder_not_found');
      if(!liveTabs.includes(tab_id)||!validTabId(tab_id)||!title(label))throw Error('education_chat_binding_invalid');
      if(s.chats.some(c=>c.tab_id===tab_id))throw Error('education_tab_already_bound');
      const chat={id:crypto.randomUUID(),folder_id,tab_id,title:title(label),
        created_at:new Date().toISOString()};
      s.chats.push(chat);return snapshot(chat);});
  }
  addNote({lesson_id,text:body}={}){
    return this.#change(s=>{
      if(!LESSONS.some(l=>l.id===lesson_id)||typeof body!=='string'
        ||body.trim().length<1||body.length>4000)
        throw Error('education_note_invalid');
      const note={id:crypto.randomUUID(),lesson_id,text:body.trim(),at:new Date().toISOString()};
      s.notes.push(note);return snapshot(note);
    });
  }
  addLabReport({lesson_id,title:label,kind='analysis',observation}={}){
    return this.#change(s=>{
      if(!LESSONS.some(l=>l.id===lesson_id)||!title(label)
        ||!['simulation','physical','analysis'].includes(kind)
        ||typeof observation!=='string'||observation.trim().length<1||observation.length>4000)
        throw Error('education_lab_invalid');
      const lab={id:crypto.randomUUID(),lesson_id,title:title(label),kind,
        observation:observation.trim(),provenance:'self_reported_unverified',
        at:this.#now().toISOString()};
      s.labs.push(lab);return snapshot(lab);
    });
  }
  submitAnswer({question_id,choice}={}){
    return this.#change(s=>{const q=BANK.find(q=>q.id===question_id);
      if(!q||!Number.isInteger(choice)||choice<0||choice>=q.choices.length)
        throw Error('education_assessment_invalid');
      const at=this.#now().toISOString();
      const attempt={id:crypto.randomUUID(),question_id,choice,
        passed:choice===q.correct,at};
      const previous=s.reviews.find(r=>r.question_id===question_id);
      const review=nextReview(previous,attempt.passed,at);
      if(previous)Object.assign(previous,review);
      else s.reviews.push({question_id,...review});
      s.attempts.push(attempt);return {...attempt,review:structuredClone(review),
        explanation:q.explanation,correct_choice:q.correct};});
  }
}
