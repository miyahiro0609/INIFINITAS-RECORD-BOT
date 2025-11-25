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

const CLEAR_TYPES = [
  'FAILED',
  'ASSIST CLEAR',
  'EASY CLEAR',
  'CLEAR',
  'HARD CLEAR',
  'EX-HARD CLEAR',
  'FULL COMBO'
];

const DIFFICULTIES = ['NORMAL', 'HYPER', 'ANOTHER', 'LEGGENDARIA'];

// 速度の選択肢を生成
const SPEEDS = [];
for (let i = 0.7; i <= 1.5; i += 0.1) {
  SPEEDS.push({ name: `${Math.round(i * 10) / 10}x`, value: `${Math.round(i * 10) / 10}` });
}

// データベーステーブルを初期化
async function initDatabase() {
  console.log('データベース接続を試行中...');
  const client = await pool.connect();
  console.log('✅ データベース接続成功');
  
  try {
    console.log('テーブル作成クエリを実行中...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS records (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        song VARCHAR(255) NOT NULL,
        difficulty VARCHAR(50) NOT NULL,
        speed DECIMAL(2,1) NOT NULL,
        score INTEGER NOT NULL,
        miss_count INTEGER NOT NULL,
        clear_type VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, song, difficulty, speed)
      )
    `);
    console.log('✅ テーブル作成/確認完了');
  } catch (error) {
    console.error('❌ テーブル作成エラー:', error);
    throw error;
  } finally {
    client.release();
    console.log('データベース接続を解放しました');
  }
}

// スラッシュコマンドの定義
const commands = [
  new SlashCommandBuilder()
    .setName('record')
    .setDescription('スコアを記録します')
    .addStringOption(option =>
      option.setName('song')
        .setDescription('楽曲名')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('difficulty')
        .setDescription('難易度')
        .setRequired(true)
        .addChoices(
          { name: 'NORMAL', value: 'NORMAL' },
          { name: 'HYPER', value: 'HYPER' },
          { name: 'ANOTHER', value: 'ANOTHER' },
          { name: 'LEGGENDARIA', value: 'LEGGENDARIA' }
        ))
    .addStringOption(option =>
      option.setName('speed')
        .setDescription('速度')
        .setRequired(true)
        .addChoices(...SPEEDS))
    .addIntegerOption(option =>
      option.setName('score')
        .setDescription('スコア')
        .setRequired(true)
        .setMinValue(0))
    .addIntegerOption(option =>
      option.setName('miss')
        .setDescription('ミスカウント')
        .setRequired(true)
        .setMinValue(0))
    .addStringOption(option =>
      option.setName('clear')
        .setDescription('クリアタイプ')
        .setRequired(true)
        .addChoices(
          { name: 'FAILED', value: 'FAILED' },
          { name: 'ASSIST CLEAR', value: 'ASSIST CLEAR' },
          { name: 'EASY CLEAR', value: 'EASY CLEAR' },
          { name: 'CLEAR', value: 'CLEAR' },
          { name: 'HARD CLEAR', value: 'HARD CLEAR' },
          { name: 'EX-HARD CLEAR', value: 'EX-HARD CLEAR' },
          { name: 'FULL COMBO', value: 'FULL COMBO' }
        )),
  
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('スコアを検索します')
    .addStringOption(option =>
      option.setName('song')
        .setDescription('楽曲名')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('difficulty')
        .setDescription('難易度')
        .setRequired(true)
        .addChoices(
          { name: 'NORMAL', value: 'NORMAL' },
          { name: 'HYPER', value: 'HYPER' },
          { name: 'ANOTHER', value: 'ANOTHER' },
          { name: 'LEGGENDARIA', value: 'LEGGENDARIA' }
        ))
    .addStringOption(option =>
      option.setName('speed')
        .setDescription('速度')
        .setRequired(true)
        .addChoices(...SPEEDS)),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('全記録を表示します')
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('表示件数（デフォルト: 10）')
        .setMinValue(1)
        .setMaxValue(25)),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('統計情報を表示します')
].map(command => command.toJSON());

// ヘルパー関数
function isBetterRecord(newRec, oldRec) {
  if (!oldRec) return true;
  
  const newClearIdx = CLEAR_TYPES.indexOf(newRec.clearType);
  const oldClearIdx = CLEAR_TYPES.indexOf(oldRec.clear_type);
  
  if (newClearIdx > oldClearIdx) return true;
  if (newClearIdx < oldClearIdx) return false;
  
  if (newRec.score > oldRec.score) return true;
  if (newRec.score < oldRec.score) return false;
  
  return newRec.missCount < oldRec.miss_count;
}

function getClearTypeEmoji(type) {
  const emojis = {
    'FAILED': '❌',
    'ASSIST CLEAR': '💜',
    'EASY CLEAR': '💚',
    'CLEAR': '💙',
    'HARD CLEAR': '❤️',
    'EX-HARD CLEAR': '🧡',
    'FULL COMBO': '⭐'
  };
  return emojis[type] || '⚪';
}

function getDifficultyEmoji(diff) {
  const emojis = {
    'NORMAL': '🔵',
    'HYPER': '🟡',
    'ANOTHER': '🔴',
    'LEGGENDARIA': '🟣'
  };
  return emojis[diff] || '⚪';
}

// Botクライアントの作成
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Bot起動時
client.once('ready', async () => {
  console.log(`${client.user.tag} でログインしました！`);
  
  // データベース初期化
  await initDatabase();
  
  // コマンド登録
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('スラッシュコマンドを登録中...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands },
    );
    console.log('スラッシュコマンドの登録完了！');
  } catch (error) {
    console.error('コマンド登録エラー:', error);
  }
});

// コマンド処理
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  try {
    if (commandName === 'record') {
      const song = interaction.options.getString('song');
      const difficulty = interaction.options.getString('difficulty');
      const speed = parseFloat(interaction.options.getString('speed'));
      const score = interaction.options.getInteger('score');
      const missCount = interaction.options.getInteger('miss');
      const clearType = interaction.options.getString('clear');

      // 既存の記録を取得
      const existingQuery = await pool.query(
        'SELECT * FROM records WHERE user_id = $1 AND song = $2 AND difficulty = $3 AND speed = $4',
        [user.id, song, difficulty, speed]
      );

      const newRecord = {
        userId: user.id,
        username: user.username,
        song,
        difficulty,
        speed,
        score,
        missCount,
        clearType
      };

      const existingRecord = existingQuery.rows[0];
      const isNewBest = isBetterRecord(newRecord, existingRecord);

      if (isNewBest) {
        // レコードを挿入または更新
        await pool.query(
          `INSERT INTO records (user_id, username, song, difficulty, speed, score, miss_count, clear_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id, song, difficulty, speed)
           DO UPDATE SET score = $6, miss_count = $7, clear_type = $8, username = $2, created_at = CURRENT_TIMESTAMP`,
          [user.id, user.username, song, difficulty, speed, score, missCount, clearType]
        );
      }

      const embed = new EmbedBuilder()
        .setColor(isNewBest ? 0xFFD700 : 0x808080)
        .setTitle(isNewBest ? '✨ ベスト記録更新！' : 'ℹ️ 記録登録')
        .setDescription(`**${song}**`)
        .addFields(
          { name: '難易度', value: `${getDifficultyEmoji(difficulty)} ${difficulty}`, inline: true },
          { name: '速度', value: `${speed}x`, inline: true },
          { name: 'スコア', value: score.toLocaleString(), inline: true },
          { name: 'ミス', value: missCount.toString(), inline: true },
          { name: 'クリア', value: `${getClearTypeEmoji(clearType)} ${clearType}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: user.username });

      await interaction.reply({ embeds: [embed] });

    } else if (commandName === 'search') {
      const song = interaction.options.getString('song');
      const difficulty = interaction.options.getString('difficulty');
      const speed = parseFloat(interaction.options.getString('speed'));

      const result = await pool.query(
        'SELECT * FROM records WHERE user_id = $1 AND song = $2 AND difficulty = $3 AND speed = $4',
        [user.id, song, difficulty, speed]
      );

      if (result.rows.length === 0) {
        await interaction.reply({
          content: '❌ 該当する記録が見つかりませんでした',
          ephemeral: true
        });
        return;
      }

      const record = result.rows[0];

      const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle('🔍 記録検索結果')
        .setDescription(`**${record.song}**`)
        .addFields(
          { name: '難易度', value: `${getDifficultyEmoji(record.difficulty)} ${record.difficulty}`, inline: true },
          { name: '速度', value: `${record.speed}x`, inline: true },
          { name: 'スコア', value: record.score.toLocaleString(), inline: true },
          { name: 'ミス', value: record.miss_count.toString(), inline: true },
          { name: 'クリア', value: `${getClearTypeEmoji(record.clear_type)} ${record.clear_type}`, inline: true }
        )
        .setTimestamp(new Date(record.created_at))
        .setFooter({ text: `記録者: ${record.username}` });

      await interaction.reply({ embeds: [embed] });

    } else if (commandName === 'list') {
      const limit = interaction.options.getInteger('limit') || 10;

      const result = await pool.query(
        'SELECT * FROM records WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [user.id, limit]
      );

      if (result.rows.length === 0) {
        await interaction.reply({
          content: 'まだ記録がありません',
          ephemeral: true
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📊 あなたの記録一覧（最新${limit}件）`)
        .setDescription(
          result.rows.map((r, i) => 
            `**${i + 1}.** ${r.song}\n` +
            `${getDifficultyEmoji(r.difficulty)} ${r.difficulty} | ${r.speed}x | ${r.score.toLocaleString()}点 | Miss: ${r.miss_count} | ${getClearTypeEmoji(r.clear_type)} ${r.clear_type}`
          ).join('\n\n')
        )
        .setTimestamp()
        .setFooter({ text: user.username });

      await interaction.reply({ embeds: [embed] });

    } else if (commandName === 'stats') {
      const result = await pool.query(
        `SELECT 
          COUNT(*) as total_records,
          AVG(score)::INTEGER as avg_score,
          MAX(score) as max_score,
          SUM(CASE WHEN clear_type = 'FULL COMBO' THEN 1 ELSE 0 END) as full_combos
         FROM records WHERE user_id = $1`,
        [user.id]
      );

      const stats = result.rows[0];

      if (stats.total_records == 0) {
        await interaction.reply({
          content: 'まだ記録がありません',
          ephemeral: true
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('📈 あなたの統計情報')
        .addFields(
          { name: '総記録数', value: stats.total_records.toString(), inline: true },
          { name: '平均スコア', value: (stats.avg_score || 0).toLocaleString(), inline: true },
          { name: '最高スコア', value: (stats.max_score || 0).toLocaleString(), inline: true },
          { name: 'フルコンボ数', value: `⭐ ${stats.full_combos}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: user.username });

      await interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('コマンド処理エラー:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'エラーが発生しました',
        ephemeral: true
      });
    }
  }
});

// エラーハンドリング
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Bot起動時
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} でログインしました！`);
  
  try {
    // データベース初期化
    console.log('データベース初期化を開始...');
    await initDatabase();
    console.log('✅ データベース初期化完了');
  } catch (error) {
    console.error('❌ データベース初期化エラー:', error);
    console.error('エラー詳細:', error.stack);
  }
  
  // コマンド登録
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('スラッシュコマンドを登録中...');
    console.log('登録するコマンド数:', commands.length);
    
    const data = await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands },
    );
    
    console.log(`✅ ${data.length}個のスラッシュコマンドを登録しました！`);
    console.log('登録されたコマンド:', data.map(cmd => cmd.name).join(', '));
  } catch (error) {
    console.error('❌ コマンド登録エラー:', error);
    if (error.rawError) {
      console.error('詳細:', JSON.stringify(error.rawError, null, 2));
    }
  }
});

// エラーイベントのハンドリング
client.on('error', error => {
  console.error('❌ Discord Clientエラー:', error);
});

client.on('warn', info => {
  console.warn('⚠️ Discord Client警告:', info);
});

// プロセス全体のエラーハンドリング
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
  console.error('スタックトレース:', error.stack);
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught exception:', error);
  console.error('スタックトレース:', error.stack);
  process.exit(1);
});

// Botを起動
console.log('Botログイン処理を開始...');
client.login(TOKEN)
  .then(() => {
    console.log('✅ ログイン処理が開始されました');
  })
  .catch(error => {
    console.error('❌ ログインエラー:', error);
    console.error('TOKENが正しいか確認してください');
    process.exit(1);
  });

console.log('bot.jsの実行完了（ログイン処理は非同期で継続）');