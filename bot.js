const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// 環境変数から取得
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

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

// スコアデータを保存（メモリ上）
const records = new Map();

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
].map(command => command.toJSON());

// ヘルパー関数
function getRecordKey(userId, song, difficulty, speed) {
  return `${userId}__${song}__${difficulty}__${speed}`;
}

function isBetterRecord(newRec, oldRec) {
  if (!oldRec) return true;
  
  const newClearIdx = CLEAR_TYPES.indexOf(newRec.clearType);
  const oldClearIdx = CLEAR_TYPES.indexOf(oldRec.clearType);
  
  if (newClearIdx > oldClearIdx) return true;
  if (newClearIdx < oldClearIdx) return false;
  
  if (newRec.score > oldRec.score) return true;
  if (newRec.score < oldRec.score) return false;
  
  return newRec.missCount < oldRec.missCount;
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
      const speed = interaction.options.getString('speed');
      const score = interaction.options.getInteger('score');
      const missCount = interaction.options.getInteger('miss');
      const clearType = interaction.options.getString('clear');

      const key = getRecordKey(user.id, song, difficulty, speed);
      const newRecord = {
        song,
        difficulty,
        speed: parseFloat(speed),
        score,
        missCount,
        clearType,
        date: new Date().toISOString(),
        userId: user.id,
        username: user.username
      };

      const existingRecord = records.get(key);
      const isNewBest = isBetterRecord(newRecord, existingRecord);

      if (isNewBest) {
        records.set(key, newRecord);
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
      const speed = interaction.options.getString('speed');

      const key = getRecordKey(user.id, song, difficulty, speed);
      const record = records.get(key);

      if (!record) {
        await interaction.reply({
          content: '❌ 該当する記録が見つかりませんでした',
          ephemeral: true
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle('🔍 記録検索結果')
        .setDescription(`**${record.song}**`)
        .addFields(
          { name: '難易度', value: `${getDifficultyEmoji(record.difficulty)} ${record.difficulty}`, inline: true },
          { name: '速度', value: `${record.speed}x`, inline: true },
          { name: 'スコア', value: record.score.toLocaleString(), inline: true },
          { name: 'ミス', value: record.missCount.toString(), inline: true },
          { name: 'クリア', value: `${getClearTypeEmoji(record.clearType)} ${record.clearType}`, inline: true }
        )
        .setTimestamp(new Date(record.date))
        .setFooter({ text: `記録者: ${record.username}` });

      await interaction.reply({ embeds: [embed] });

    } else if (commandName === 'list') {
      const userRecords = Array.from(records.values())
        .filter(r => r.userId === user.id)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10);

      if (userRecords.length === 0) {
        await interaction.reply({
          content: 'まだ記録がありません',
          ephemeral: true
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📊 あなたの記録一覧（最新10件）')
        .setDescription(
          userRecords.map((r, i) => 
            `**${i + 1}.** ${r.song}\n` +
            `${getDifficultyEmoji(r.difficulty)} ${r.difficulty} | ${r.speed}x | ${r.score.toLocaleString()}点 | Miss: ${r.missCount} | ${getClearTypeEmoji(r.clearType)} ${r.clearType}`
          ).join('\n\n')
        )
        .setTimestamp()
        .setFooter({ text: user.username });

      await interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('コマンド処理エラー:', error);
    if (!interaction.replied) {
      await interaction.reply({
        content: 'エラーが発生しました',
        ephemeral: true
      });
    }
  }
});

// Botを起動
client.login(TOKEN);