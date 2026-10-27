'use strict';
// Local components render data only. No innerHTML, eval, model CSS, URL or script.
window.renderEducationModules=function(root,material,{readImage}={}){
  const blocks=material?.blocks||[],fingerprint=JSON.stringify([material?.id,blocks]);
  if(root.dataset.fingerprint===fingerprint)return;
  root.dataset.fingerprint=fingerprint;root.replaceChildren();
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const names={text:'Разбор',callout:'Обрати внимание',formula:'Формула',checklist:'Практический план',table:'Таблица',quiz:'Мини-тест',diagram:'Схема',image:'Изображение',ohm_lab:'Виртуальная лаборатория'};
  for(const b of blocks){
    const card=el('article',undefined,'module-card '+b.kind);card.dataset.blockId=b.id;
    card.append(el('span',names[b.kind]||'Учебный блок','module-type'),el('h3',b.title));
    if(['text','callout','formula'].includes(b.kind))card.append(el('p',b.text,b.kind==='formula'?'formula-text':undefined));
    else if(b.kind==='checklist')for(const text of b.items){const label=el('label');const c=el('input');c.type='checkbox';label.append(c,el('span',text));card.append(label);}
    else if(b.kind==='table'){
      const wrap=el('div',undefined,'module-table-wrap'),table=el('table'),head=el('thead'),row=el('tr');
      for(const c of b.columns){const th=el('th',c);th.scope='col';row.append(th);}head.append(row);table.append(head);
      const body=el('tbody');for(const cells of b.rows){const tr=el('tr');for(const c of cells)tr.append(el('td',c));body.append(tr);}table.append(body);wrap.append(table);card.append(wrap);
    }else if(b.kind==='quiz'){
      card.append(el('p',b.question));const choices=el('div',undefined,'quiz-choices'),feedback=el('p');feedback.setAttribute('role','status');
      b.choices.forEach((text,i)=>{const button=el('button',(i+1)+'. '+text);button.onclick=()=>{
        feedback.textContent=(i===b.correct_index?'Ответ совпадает с ключом GPT. ':'По ключу GPT ответ другой. ')+b.explanation+' Это тренировочный модуль, не независимая оценка знаний.';
        feedback.className='quiz-feedback';};choices.append(button);});card.append(choices,feedback);
    }else if(b.kind==='image'){
      const figure=el('figure'),status=el('small','Загрузка локального изображения…');figure.append(status,el('figcaption',b.caption));card.append(figure);
      if(typeof readImage==='function')readImage({material_id:material.id,asset_id:b.asset_id}).then(result=>{
        if(!card.isConnected||root.dataset.fingerprint!==fingerprint)return;
        if(typeof result.data_url!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.data_url))throw Error('image_invalid');
        const img=el('img');img.alt=b.alt;img.loading='lazy';img.decoding='async';img.src=result.data_url;status.replaceWith(img);
      }).catch(()=>{if(card.isConnected)status.textContent='Изображение недоступно. Повторно импортируй исходный файл для этой темы.';});
      else status.textContent='Для изображения требуется локальное хранилище приложения.';
    }else if(b.kind==='diagram'){
      const ns='http://www.w3.org/2000/svg',svg=(tag,attrs={})=>{const n=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,String(value));return n;};
      const cols=Math.min(3,b.nodes.length),rows=Math.ceil(b.nodes.length/cols),w=720,h=rows*106+14;
      const image=svg('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':b.title,class:'module-diagram'}),defs=svg('defs');
      const markerId='arrow-'+material.id+'-'+b.id,marker=svg('marker',{id:markerId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
      const arrow=svg('path',{d:'M 0 0 L 10 5 L 0 10 z',style:'fill:#80b9ad;stroke:none'});marker.append(arrow);defs.append(marker);image.append(defs);
      const positions=new Map(b.nodes.map((n,i)=>[n.id,{x:16+(i%cols)*(w/cols),y:14+Math.floor(i/cols)*106,width:w/cols-44,height:58,label:n.label}]));
      for(const edge of b.edges){const a=positions.get(edge.from),z=positions.get(edge.to);if(!a||!z)continue;
        const x1=a.x+a.width,y1=a.y+a.height/2,x2=z.x-4,y2=z.y+z.height/2;
        image.append(svg('path',{d:`M ${x1} ${y1} C ${x1+24} ${y1}, ${x2-24} ${y2}, ${x2} ${y2}`,'marker-end':`url(#${markerId})`}));}
      for(const [id,n]of positions){image.append(svg('rect',{x:n.x,y:n.y,width:n.width,height:n.height,rx:9}));
        const t=svg('text',{x:n.x+12,y:n.y+24});const words=n.label.match(/.{1,22}(?:\s|$)|.{1,22}/g)||[n.label];
        words.slice(0,2).forEach((line,i)=>{const span=svg('tspan',{x:n.x+12,dy:i?17:0});span.textContent=line.trim()+(i===1&&words.length>2?'…':'');t.append(span);});
        const title=svg('title');title.textContent=n.label;t.append(title);image.append(t);}
      card.append(image,el('p',b.caption));
      if(b.edges.length){const relations=el('details');relations.append(el('summary','Связи схемы'));for(const edge of b.edges){const a=positions.get(edge.from),z=positions.get(edge.to);relations.append(el('p',`${a.label} → ${z.label}${edge.label?' — '+edge.label:''}`));}card.append(relations);}
    }else if(b.kind==='ohm_lab'){
      const inputs=el('div',undefined,'lab-inputs'),result=el('div',undefined,'lab-result');
      const field=(label,value,min,max)=>{const l=el('label',label),i=el('input');i.type='number';i.min=min;i.max=max;i.step='any';i.value=value;l.append(i);inputs.append(l);return i;};
      const u=field('Напряжение, В',b.voltage,0,24),r=field('Сопротивление, Ом',b.resistance,1,1000000),current=el('output'),power=el('output');
      const compute=()=>{const U=Number(u.value),R=Number(r.value);if(!u.value||!r.value||!u.validity.valid||!r.validity.valid||!Number.isFinite(U)||!Number.isFinite(R)){current.textContent='Проверь значения';power.textContent='—';return;}
        current.replaceChildren(el('small','Ток I = U / R'),el('span',(U/R*1000).toLocaleString('ru-RU',{maximumFractionDigits:4})+' мА'));
        power.replaceChildren(el('small','Мощность P = U² / R'),el('span',(U*U/R).toLocaleString('ru-RU',{maximumFractionDigits:4})+' Вт'));};
      u.oninput=r.oninput=compute;compute();result.append(current,power);card.append(inputs,result,el('small','Идеальная модель резистора. Только виртуальный расчёт, не инструкция по сборке физической цепи.'));
    }
    card.append(el('div','Модуль сформирован GPT · содержание требует проверки','unverified'));root.append(card);
  }
};
