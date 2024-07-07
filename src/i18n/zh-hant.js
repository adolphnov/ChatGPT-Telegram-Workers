/**
 * @type {I18n}
 */
export default {
  env: {
    'system_init_message': '你是一個得力的助手',
  },
  utils: {
    'not_supported_configuration': '不支持的配置或數據類型錯誤',
  },
  message: {
    'loading': '加载中',
    'not_supported_chat_type': (type) => `當前不支持${type}類型的聊天`,
    'not_supported_chat_type_message': '當前不支持非文本格式消息',
    'handle_chat_type_message_error': (type) => `處理${type}類型的聊天消息出錯`,
    'user_has_no_permission_to_use_the_bot': (id) =>
      `您沒有權限使用本機器人，請聯繫管理員將您的ID(${id})添加到白名單中`,
    'group_has_no_permission_to_use_the_bot': (id) =>
      `該群組未開啟聊天權限，請聯繫管理員將該群組ID(${id})添加到白名單中`,
    'history_empty': '暫無歷史消息',
    'refreshchatlist': '請先執行`/refreshchatlist`命令刷新列表`',
    'chatlist_not_found': '未查到任何對話記錄',
    'new_chat_or_id_is_empty': '當前為新對話或ID為空',
  },
  command: {
    help: {
      'summary': '當前支持的命令如下：\n',
      'help': '獲取命令幫助',
      'new': '開始一個新對話',
      'start': '獲取您的ID並開始一個新對話',
      'img': '生成圖片，完整命令格式為`/img 圖片描述`，例如`/img 海灘月光`',
      'version': '獲取當前版本號確認是否需要更新',
      'setenv': '設置用戶配置，完整命令格式為/setenv KEY=VALUE',
      'setenvs': '批量設置用户配置, 命令完整格式為 /setenvs {"KEY1": "VALUE1", "KEY2": "VALUE2"}',
      'delenv': '刪除用戶配置，完整命令格式為/delenv KEY',
      'clearenv': '清除所有用戶配置',
      'usage': '獲取機器人當前的使用情況統計',
      'system': '查看一些系統信息',
      'role': '設置預設身份',
      'redo': '重做上一次的對話 /redo 加修改過的內容 或者 直接 /redo',
      'echo': '回显消息',
      'bill': '查看當前的賬單',
      'mode': '設置當前模式 命令完整格式為 `/mode NAME`，當 NAME=all 時，查看所有模式',
      'chatlist': '查詢對話列表',
      'history': '查詢歷史記錄',
      'setid': '設置對話 ID 格式為 `/setid id`',
      'setalias': '設置對話別名 格式為 `/setalias 對話序列號(数字) 別名`',
      'refreshchatlist': '更新緩存的對話列表',
    },
    role: {
      'not_defined_any_role': '尚未定義任何角色',
      'current_defined_role': (size) => `當前已定義的角色如下(${size})：\n`,
      'help':
        '格式錯誤：完整命令格式為`/role 操作`\n' +
        '當前支持的`操作`如下：\n' +
        ' `/role show` 查看當前已定義的角色。\n' +
        ' `/role 角色名 del` 刪除指定的角色。\n' +
        ' `/role 角色名 KEY=VALUE` 設置指定角色的配置。\n' +
        '  當前支持的設置如下：\n' +
        '   `SYSTEM_INIT_MESSAGE`：初始化消息\n' +
        '   `OPENAI_API_EXTRA_PARAMS`：OpenAI API額外參數，必須為JSON',
      'delete_role_success': '刪除角色成功',
      'delete_role_error': (e) => `刪除角色出錯：\`${e.message}\``,
      'update_role_success': '更新配置成功',
      'update_role_error': (e) => `配置項格式錯誤：\`${e.message}\``,
    },
    img: {
      'help': '請輸入圖片描述。完整命令格式為`/img raccoon cat`',
    },
    new: {
      'new_chat_start': '開始一個新對話',
      'new_chat_start_private': (id) => `開始一個新對話，您的ID(${id})`,
      'new_chat_start_group': (id) => `開始一個新對話，群組ID(${id})`,
    },
    setenv: {
      'help': '配置項格式錯誤：完整命令格式為/setenv KEY=VALUE',
      'update_config_success': '更新配置成功',
      'update_config_error': (e) => `配置項格式錯誤：\`${e.message}\``,
    },
    version: {
      'new_version_found': (current, online) =>
        `發現新版本，當前版本：${JSON.stringify(current)}，最新版本：${JSON.stringify(online)}`,
      'current_is_latest_version': (current) => `當前已是最新版本，當前版本：${JSON.stringify(current)}`,
    },
    usage: {
      'usage_not_open': '當前機器人未開啟使用情況統計',
      'current_usage': '📊 當前機器人使用情況\n\n使用情況：\n',
      'total_usage': (total) => `- 總計：${total || 0} 次\n- 每個群組使用情況： `,
      'no_usage': '- 暫無使用情況',
    },
    permission: {
      'not_authorized': '身份權限驗證失敗',
      'not_enough_permission': (roleList, chatRole) => `權限不足，需要${roleList.join(',')}，當前：${chatRole}`,
      'role_error': (e) => `身份驗證出錯：` + e.message,
      'command_error': (e) => `命令執行出錯：${e.message}`,
    },
    bill: {
      'bill_detail': (totalAmount, totalUsage, remaining) =>
        `📊 本月机器人用量\n\n\t- 总额度: $${totalAmount || 0}\n\t- 已使用: $${totalUsage || 0}\n\t- 剩余额度: $${remaining || 0}`,
    },
    mode: {
      'help': '配置項格式錯誤: 命令格式為 /mode NAME, 当NAME=all时, 查看所有mode',
    },
    setid: {
      'help': '配置項格式錯誤：命令格式為 `/setid id`',
      'out_of_range': (length) => `索引大小超出范围：${length}`,
      'alias_not_found': (alias) => `找不到对应的别名：${alias}`,
    },
    setalias: {
      'help': '配置項格式錯誤：命令格式為 `/setalias index alias`',
    },
    refreshchatlist: {
      'refresh_success': (length) => `共刷新${length}个记录`,
    },
    history: {
      'query_error': '無法獲取父消息id',
    },
  }
};
