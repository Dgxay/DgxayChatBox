/** 统一的线性图标集合（24×24，currentColor） */
const wrap = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  send: wrap('<path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke-width="2" />'),
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/></svg>',
  file: wrap('<path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7l-4-4Z"/><path d="M14 3v4h4"/>'),
  folder: wrap('<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.6l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z"/>'),
  folderPlus: wrap('<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.6l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  terminal: wrap('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 9.5l2.5 2.5L7 14.5M12.5 15H17"/>'),
  globe: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.6 5.4 3.6 8.5S14.4 18 12 20.5C9.6 18 8.4 15.1 8.4 12S9.6 6 12 3.5Z"/>'),
  trash: wrap('<path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12"/><path d="M10 11v5M14 11v5"/>'),
  pencil: wrap('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5l3 3"/>'),
  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  check: wrap('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  spinner: wrap('<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" opacity="0.9"/>'),
  alert: wrap('<path d="M12 4l9 16H3l9-16Z"/><path d="M12 10v4.5M12 17.2v.1"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  x: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  copy: wrap('<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M15 6.5A2.5 2.5 0 0 0 12.5 4H6a2 2 0 0 0-2 2v6.5A2.5 2.5 0 0 0 6.5 15"/>'),
  spark: wrap('<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5Z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>'),
  chat: wrap('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6a2.5 2.5 0 0 1-2.5 2.5H9.8L5 18.4V6.5Z"/>'),
  work: wrap('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H10l2 2h5.5A2.5 2.5 0 0 1 20 10.5v7A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-9Z"/>'),
  shield: wrap('<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z"/>'),
  key: wrap('<circle cx="8.5" cy="12" r="4"/><path d="M12.5 12H21M18 12v3M15.5 12v2.2"/>'),
  refresh: wrap('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V9h-4.5"/>'),
  settings: wrap('<circle cx="12" cy="12" r="3.2"/><path d="M20 13.4a7.9 7.9 0 0 0 0-2.8l1.7-1.3-2-3.4-2 .8a8 8 0 0 0-2.4-1.4L14.9 3h-4l-.4 2.3a8 8 0 0 0-2.4 1.4l-2-.8-2 3.4L5.9 10.6a7.9 7.9 0 0 0 0 2.8L4.1 14.7l2 3.4 2-.8a8 8 0 0 0 2.4 1.4l.4 2.3h4l.4-2.3a8 8 0 0 0 2.4-1.4l2 .8 2-3.4-1.7-1.3Z"/>'),
  external: wrap('<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18.5 14.5v3.2A2.3 2.3 0 0 1 16.2 20H6.3A2.3 2.3 0 0 1 4 17.7V7.8A2.3 2.3 0 0 1 6.3 5.5H10"/>'),
  image: wrap('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.8-4.5 3.4 3 2.6-2.4 4.2 4"/>'),
  code: wrap('<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>'),
  book: wrap('<path d="M4 5.5A2 2 0 0 1 6 3.5h5v17H6a2 2 0 0 1-2-2v-13Z"/><path d="M20 5.5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 0 2-2v-13Z"/>'),
  calendar: wrap('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5V6M16 3.5V6"/>')
};

export const toolIcons = {
  read_file: icons.file,
  list_directory: icons.folder,
  write_file: icons.pencil,
  create_directory: icons.folderPlus,
  delete_path: icons.trash,
  run_command: icons.terminal,
  fetch_url: icons.globe
};

export const toolLabels = {
  read_file: '读取文件',
  list_directory: '浏览目录',
  write_file: '写入文件',
  create_directory: '创建文件夹',
  delete_path: '删除文件',
  run_command: '执行命令',
  fetch_url: '联网获取'
};
