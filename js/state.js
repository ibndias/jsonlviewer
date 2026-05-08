// js/state.js
export const state = {
  fileName: '',
  mode: 'unknown',
  sourceShape: 'array',
  modeNewlines: true,
  colorize: false,
  quickCopy: false,
  markdown: false,
  editMode: false,
  items: [],
  schema: new Map(),
  selectedKeys: new Set(),
  searchQuery: '',
  minTokens: null,
  maxTokens: null,
  sortMode: 'default',
  pageSize: 200,
  pagesShown: 1,
  viewItems: [],
  activeOrigIdx: -1,
  files: [],          // [{id, folder, snapshot}]
  activeId: null,
};

let _fileIdCounter = 0;
export const newFileId = () => 'f' + (++_fileIdCounter);

export const liveItems = () => state.items.filter(it => !it.deleted);
