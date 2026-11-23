// 從假資料取出所有組織名與人名。查核腳本與單元測試共用。
import { buildInitialState } from '../src/mock';
import { ORG } from '../src/mock/org';

export interface MockNames {
  orgsZh: string[];
  orgsEn: string[];
  peopleZh: string[];
  peopleEn: string[];
}

const uniq = (list: string[]) => [...new Set(list)];

export function collectNames(): MockNames {
  const state = buildInitialState();
  return {
    orgsZh: uniq([ORG.name.zh, ...state.vendors.map((v) => v.name.zh)]),
    orgsEn: uniq([ORG.name.en, ...state.vendors.map((v) => v.name.en)]),
    peopleZh: uniq(state.people.map((p) => p.name.zh)),
    peopleEn: uniq(state.people.map((p) => p.name.en)),
  };
}

/** 組織名去掉行業別的字尾，剩下自創的那兩個字。公司登記用這兩個字查「名稱包含」，比查全名嚴格。 */
export function coreOf(name: string): string {
  return name.replace(/(金融|資訊|科技|軟體|系統)$/, '');
}

/** 英文組織名的第一個字（自創的那個字）。 */
export function firstWord(name: string): string {
  return name.split(' ')[0];
}
