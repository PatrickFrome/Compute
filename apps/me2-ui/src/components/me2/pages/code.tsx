"use client";
import {ManagedProjects} from '@/components/me2/managed-projects';
import {ManagedProjectHistory} from '@/components/me2/managed-project-history';

export function CodePage(){return <div className="mx-auto max-w-[1100px] space-y-4" data-testid="page-code">
  <header><h1 className="text-xl font-medium">Проекты и история</h1><p className="mt-2 text-sm text-zinc-400">Создание и открытие назначенных рабочих проектов выполняет клиент после проверки доступа. История показывает сохранённые события.</p></header>
  <div className="grid items-start gap-4 lg:grid-cols-2"><ManagedProjects/><ManagedProjectHistory/></div>
</div>;}
