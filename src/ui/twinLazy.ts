// 首屏畫完之後才下載的那一包：3D 的引擎，加上「全台」與「海外」兩個比例尺的面板。
// 兩樣東西放在同一個入口，打包時才會是同一個檔案；分開載入的話，
// 打包工具會把它們共用的模組從首屏的檔案裡拆出去，首屏反而變大。
export { createTwin } from '../three/twin';
export { createScales } from './twinScales';
