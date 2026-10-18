/**
 * **把 IndexedDB 换成内存实现**：应用运行时不再往浏览器（C 盘）写任何持久存档。
 *
 * 背景：Chrome 的 IndexedDB 位于用户目录（`…/User Data/Default/IndexedDB`），
 * 实测这个源吃掉了 1.55 GB —— 它不是"本地存档"，它是浏览器缓存。
 *
 * 现在的分工：
 *   - **真相** = 服务端 `save/` 目录（由 `services/storage/diskPersistence.ts` 的写穿透镜像落盘）；
 *   - 浏览器里的 IndexedDB 只是**本次运行的临时工作区**，刷新即清空；
 *   - 进游戏时按需从磁盘预载最新的少量存档（见 `syncFromDisk` 的预算），其余点开时再取。
 *
 * 必须在任何存储模块之前导入：ES 模块按导入顺序求值，本文件是入口的第一行。
 */
import 'fake-indexeddb/auto';
