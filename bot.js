const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { Pool } = require('pg');

// 環境変数から取得
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATABASE_URL = process.env.DATABASE_URL;

// デバッグ用ログ（本番環境では削除推奨）
console.log('=== 環境変数チェック ===');
console.log('TOKEN:', TOKEN ? '設定済み ✓' : '未設定 ✗');
console.log('CLIENT_ID:', CLIENT_ID ? '設定済み ✓' : '未設定 ✗');
console.log('DATABASE_URL:', DATABASE_URL ? '設定済み ✓' : '未設定 ✗');
console.log('========================');

// 必須環境変数のチェック
if (!TOKEN) {
  console.error('❌ エラー: TOKEN環境変数が設定されていません');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('❌ エラー: CLIENT_ID環境変数が設定されていません');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('❌ エラー: DATABASE_URL環境変数が設定されていません');
  console.error('Railway.appのVariablesタブでDATABASE_URLを設定してください');
  process.exit(1);
}

console.log('✅ 環境変数の確認完了');

// PostgreSQL接続設定
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 接続テスト
pool.on('error', (err) => {
  console.error('❌ データベース接続エラー:', err);
});