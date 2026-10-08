'use strict';
const form=document.getElementById('pairing');
const status=document.getElementById('status');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=document.getElementById('connect'),secret=document.getElementById('token');
  button.disabled=true;status.textContent='Проверяю GitHub и создаю приватный канал…';
  const token=secret.value;secret.value='';
  try{
    const result=await window.metaengineGithubChat.connect({repository:document.getElementById('repository').value.trim(),token});
    if(result?.state==='PAIRED'){
      status.textContent=`Подключён ${result.repository}, задача #${result.issue_number}. Закройте это окно, чтобы начать управление. Разрешите GitHub-приложению чата доступ к этому репозиторию.`;
      form.hidden=true;
    }else status.textContent='Подключение не подтверждено. Проверьте приватность репозитория и права токена. Эта попытка не будет повторяться автоматически.';
  }catch{status.textContent='Подключение не подтверждено. Закройте окно и проверьте настройки GitHub.';}
});
