import crypto from 'node:crypto';
import { LESSONS, CURRICULUM_VERSION } from './curriculum.mjs';

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
  {id:'safety',subject:13,title:'Оптическая безопасность',question:'Можно ли смотреть в торец неизвестного оптического волокна?',choices:['Да, если не видно света','Нет','Да, через лупу'],correct:1,explanation:'Волокно может переносить невидимое опасное оптическое излучение.'}
]);
const snapshot=value=>structuredClone(value);
const validId=value=>typeof value==='string'&&/^[a-z0-9-]{1,80}$/i.test(value);
const validTabId=value=>typeof value==='string'&&/^tab_[0-9a-f-]{36}$/i.test(value);
const title=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=100?value.trim():null;
function freshState(){
  return {schema:EDUCATION_SCHEMA,folders:SUBJECTS.map((name,index)=>({
    id:'subject-'+index,parent_id:null,title:name,order:index
  })),chats:[],attempts:[],notes:[],created_at:new Date().toISOString()};
}
function check(state){
  if(state&&state.notes===undefined)state.notes=[];
  if(!state||state.schema!==EDUCATION_SCHEMA||!Array.isArray(state.notes)||!Array.isArray(state.folders)
    ||!Array.isArray(state.chats)||!Array.isArray(state.attempts))throw Error('education_state_invalid');
  if(state.folders.length>500||state.chats.length>1000||state.attempts.length>10000||state.notes.length>1500)
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
  return state;
}
export class EducationStore{
  #disk;#state;#serial=Promise.resolve();
  constructor(disk){this.#disk=disk;}
  async init(){const saved=await this.#disk.load();this.#state=check(saved??freshState());
    if(!saved)await this.#disk.save(this.#state);return this.snapshot();}
  snapshot(){if(!this.#state)throw Error('education_not_initialized');return snapshot({
    ...this.#state,curriculum_version:CURRICULUM_VERSION,lessons:LESSONS,
    questions:BANK.map(({correct,explanation,...q})=>q),
    mastered:[...new Set(this.#state.attempts.filter(a=>a.passed).map(a=>a.question_id))]
  });}
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
  submitAnswer({question_id,choice}={}){
    return this.#change(s=>{const q=BANK.find(q=>q.id===question_id);
      if(!q||!Number.isInteger(choice)||choice<0||choice>=q.choices.length)
        throw Error('education_assessment_invalid');
      const attempt={id:crypto.randomUUID(),question_id,choice,
        passed:choice===q.correct,at:new Date().toISOString()};
      s.attempts.push(attempt);return {...attempt,explanation:q.explanation,
        correct_choice:q.correct};});
  }
}
