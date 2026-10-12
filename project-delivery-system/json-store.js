'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateDatabase(value) {
  if (!isObject(value)) throw new Error('数据库根节点必须是对象');
  for (const key of ['users', 'projects', 'design', 'production', 'batches', 'installations', 'aftersales', 'approvals', 'notifications', 'logs']) {
    if (!Array.isArray(value[key]) || value[key].some(item => !isObject(item))) {
      throw new Error('数据库集合无效：' + key);
    }
  }
  for (const key of ['sessions', 'files', 'counters', 'config']) {
    if (!isObject(value[key])) throw new Error('数据库对象无效：' + key);
  }
  for (const key of ['groups', 'field_defs']) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(item => !isObject(item)))) {
      throw new Error('数据库集合无效：' + key);
    }
  }
}

function createJsonStore(file, io = fs) {
  let unavailable = false;
  function assertAvailable() {
    if (!unavailable) return;
    const error = new Error('数据保存失败，服务已停止业务操作；请管理员检查磁盘与数据库后重启');
    error.code = 'YGX_STORAGE_UNAVAILABLE';
    throw error;
  }
  return {
    assertAvailable,
    read() {
      let text;
      try { text = io.readFileSync(file, 'utf8'); }
      catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw new Error('演示数据库无法读取，已停止启动，原文件未修改：' + error.message);
      }
      try {
        const value = JSON.parse(text);
        validateDatabase(value);
        return value;
      } catch (error) {
        throw new Error('演示数据库内容无效，已停止启动，原文件未修改：' + error.message);
      }
    },
    write(value) {
      assertAvailable();
      let fd;
      try {
        validateDatabase(value);
        const text = JSON.stringify(value, null, 1);
        const pending = file + '.pending-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
        fd = io.openSync(pending, 'wx', 0o600);
        io.writeFileSync(fd, text, 'utf8');
        io.fsyncSync(fd);
        io.closeSync(fd);
        fd = undefined;
        // Replace only after a complete write; failed temporary files remain for inspection.
        io.renameSync(pending, file);
      } catch (error) {
        unavailable = true;
        if (fd !== undefined) { try { io.closeSync(fd); } catch (_) {} }
        console.error('数据库保存失败，原文件未被主动删除：', error.message);
        assertAvailable();
      }
    },
  };
}

module.exports = { createJsonStore, validateDatabase };
