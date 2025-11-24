/*
  Single-file Discord bot implementing a /link command that:
  - sends a request embed with ✅/❌ buttons to the AdminLogs channel (configured in config.json)
  - persists pending requests across restarts (pending.json)
  - persists approved account links (accounts.json)
  - disables buttons after a decision
  - logs all actions to console and log/actions.log
  Notes:
  - npm install discord.js dotenv
  - Put token in .env: DISCORD_TOKEN=your_token_here
  - Provide config.json with at least: { "channelIDs": { "AdminLogs": "CHANNEL_ID" }, "GUILD_ID": "optional_guild_id" }
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ApplicationCommandOptionType,
  EmbedBuilder,
  PermissionsBitField
} = require('discord.js');

const DATA_DIR = path.resolve(__dirname);
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const LOG_DIR = path.join(DATA_DIR, 'log');
const LOG_FILE = path.join(LOG_DIR, 'actions.log');

// ensure log dir exists
try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { console.error('Could not create log dir', e); }

function timestamp() {
  return new Date().toISOString();
}
function appendLogLine(level, msg) {
  const line = `[${timestamp()}] [${level}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch (e) { console.error('Failed to write log file:', e); }
}
function info(msg) { console.log(msg); appendLogLine('INFO', msg); }
function warn(msg) { console.warn(msg); appendLogLine('WARN', msg); }
function errorLog(msg) { console.error(msg); appendLogLine('ERROR', msg); }

function readJson(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || 'null') || defaultValue;
  } catch (e) {
    errorLog(`Failed to read ${filePath}: ${e}`);
    return defaultValue;
  }
}
function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    errorLog(`Failed to write ${filePath}: ${e}`);
  }
}

let pending = readJson(PENDING_FILE, []); // array of pending requests
let accounts = readJson(ACCOUNTS_FILE, {}); // map: discordId -> { username, id, igns: [] }

let config = {};
try { config = require('./config.json'); } catch (e) { warn('config.json not found or invalid'); }
const TOKEN = process.env.DISCORD_TOKEN || config.DISCORD_TOKEN;
const GUILD_ID = config.GUILD_ID || process.env.GUILD_ID;
const ADMIN_CHANNEL_ID =
  process.env.ADMIN_CHANNEL_ID ||
  config.AdminLogs ||
  (config.channelIDs && config.channelIDs.AdminLogs);

// make admin role ids easy to access
const ADMIN_ROLE_IDS = Array.isArray(config.AdminRoleIDs) ? config.AdminRoleIDs : (Array.isArray(config.AdminRoleIds) ? config.AdminRoleIds : []);

if (!TOKEN) {
  errorLog('ERROR: DISCORD_TOKEN not set. Add DISCORD_TOKEN to .env or config.json');
  process.exit(1);
}
if (!ADMIN_CHANNEL_ID) {
  warn('AdminLogs not configured in config.json (must be a channel ID). /link will error when used');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const linkCommand = {
  name: 'link',
  description: 'Request admin approval to link a Minecraft IGN to a Discord account',
  options: [
    { name: 'ign', description: 'Minecraft in-game name', type: ApplicationCommandOptionType.String, required: true },
    { name: 'account', description: 'Discord account to link (if different)', type: ApplicationCommandOptionType.User, required: false }
  ]
};

function createEmbedForReq(req, status = 'pending') {
  const colorMap = { pending: 0xFFAA00, approved: 0x22AA22, rejected: 0xCC3333 };
  const embed = new EmbedBuilder()
    .setTitle('Link Request')
    .setColor(colorMap[status] || colorMap.pending)
    .addFields(
      { name: 'Requester', value: `${req.requesterTag} (<@${req.requesterId}>)`, inline: true },
      { name: 'Target', value: `${req.targetTag} (<@${req.targetId}>)`, inline: true },
      { name: 'IGN', value: `\`${req.ign}\``, inline: false }
    )
    .setFooter({ text: `Request ID: ${req.id}` })
    .setTimestamp(req.createdAt || Date.now());

  if (status === 'approved' && req.resolvedBy) {
    embed.addFields({ name: 'Decision', value: `✅ Approved by <@${req.resolvedBy}>`, inline: false });
    embed.setTimestamp(req.resolvedAt || Date.now());
  } else if (status === 'rejected' && req.resolvedBy) {
    embed.addFields({ name: 'Decision', value: `❌ Rejected by <@${req.resolvedBy}>`, inline: false });
    embed.setTimestamp(req.resolvedAt || Date.now());
  }

  return embed;
}

client.once(Events.ClientReady, async () => {
  info(`Connected. Logged in as ${client.user.tag}`);

  try {
    if (GUILD_ID) {
      const guild = await client.guilds.fetch(GUILD_ID);
      await guild.commands.create(linkCommand);
      info(`Registered /link to guild ${GUILD_ID}`);
    } else {
      await client.application.commands.create(linkCommand);
      info('Registered /link globally (may take up to an hour)');
    }
  } catch (err) {
    errorLog(`Failed to register command: ${err}`);
  }

  if (ADMIN_CHANNEL_ID) {
    try {
      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
      if (!adminChannel || !adminChannel.isTextBased()) {
        warn(`AdminLogs channel not a text channel or not found: ${ADMIN_CHANNEL_ID}`);
      } else {
        for (const req of pending.filter(p => p.status === 'pending')) {
          let message;
          if (req.messageId) {
            try { message = await adminChannel.messages.fetch(req.messageId); } catch {}
          }
          if (!message) {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`link_accept_${req.id}`).setStyle(ButtonStyle.Success).setEmoji('✅').setLabel('Approve'),
              new ButtonBuilder().setCustomId(`link_reject_${req.id}`).setStyle(ButtonStyle.Danger).setEmoji('❌').setLabel('Reject')
            );
            const embed = createEmbedForReq(req, 'pending');
            const sent = await adminChannel.send({ embeds: [embed], components: [row] });
            req.messageId = sent.id;
            writeJson(PENDING_FILE, pending);
            info(`Restored pending request message for ${req.id}`);
          } else {
            info(`Pending request ${req.id} already has message ${req.messageId}`);
          }
        }
      }
    } catch (err) {
      errorLog(`Failed to restore pending messages: ${err}`);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== 'link') return;
      const ign = interaction.options.getString('ign', true).trim();
      const targetUser = interaction.options.getUser('account') || interaction.user;
      const reqId = `${Date.now()}-${Math.floor(Math.random()*10000)}`;
      const req = {
        id: reqId,
        requesterId: interaction.user.id,
        requesterTag: `${interaction.user.username}#${interaction.user.discriminator}`,
        targetId: targetUser.id,
        targetTag: `${targetUser.username}#${targetUser.discriminator}`,
        ign,
        status: 'pending',
        createdAt: Date.now(),
        messageId: null
      };
      pending.push(req);
      writeJson(PENDING_FILE, pending);
      info(`Created link request ${req.id} requester=${req.requesterId} target=${req.targetId} ign=${req.ign}`);

      if (!ADMIN_CHANNEL_ID) {
        await interaction.reply({ content: 'AdminLogs not configured on the bot. Contact the bot owner.', ephemeral: true });
        return;
      }
      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID).catch(() => null);
      if (!adminChannel || !adminChannel.isTextBased()) {
        await interaction.reply({ content: 'AdminLogs channel not found or not a text channel. Contact the bot owner.', ephemeral: true });
        warn(`AdminLogs channel not found or not a text channel: ${ADMIN_CHANNEL_ID}`);
        return;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`link_accept_${reqId}`).setStyle(ButtonStyle.Success).setEmoji('✅').setLabel('Approve'),
        new ButtonBuilder().setCustomId(`link_reject_${reqId}`).setStyle(ButtonStyle.Danger).setEmoji('❌').setLabel('Reject')
      );

      const embed = createEmbedForReq(req, 'pending');
      const sent = await adminChannel.send({ embeds: [embed], components: [row] });
      req.messageId = sent.id;
      writeJson(PENDING_FILE, pending);
      info(`Sent admin message for request ${req.id} messageId=${req.messageId}`);

      await interaction.reply({ content: 'Link request submitted to admins.', ephemeral: true });
    }

    if (interaction.isButton()) {
      const cid = interaction.customId;
      if (!cid.startsWith('link_accept_') && !cid.startsWith('link_reject_')) return;
      const [ , action, reqId ] = cid.split('_');
      const req = pending.find(p => p.id === reqId);
      if (!req) {
        await interaction.reply({ content: 'Request not found (may have expired).', ephemeral: true });
        warn(`Button interaction for missing request ${reqId}`);
        return;
      }
      if (req.status !== 'pending') {
        await interaction.reply({ content: `This request was already ${req.status}.`, ephemeral: true });
        info(`Ignored button for already resolved request ${req.id} status=${req.status}`);
        return;
      }

      // ENFORCE ADMIN ROLES: only users with one of the configured AdminRoleIDs
      // or with ManageGuild/Administrator permission may accept/reject.
      let member = interaction.member;
      if (!member && interaction.guildId) {
        try { member = await interaction.guild.members.fetch(interaction.user.id); } catch {}
      }

      let hasAdmin = false;
      if (Array.isArray(ADMIN_ROLE_IDS) && ADMIN_ROLE_IDS.length > 0) {
        if (member && member.roles && member.roles.cache) {
          hasAdmin = member.roles.cache.some(r => ADMIN_ROLE_IDS.includes(r.id));
        }
      } else {
        // fallback: allow users with ManageGuild or Administrator permissions
        if (member && member.permissions) {
          hasAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
        }
      }

      if (!hasAdmin) {
        await interaction.reply({ content: 'You do not have permission to approve or reject link requests.', ephemeral: true });
        warn(`User ${interaction.user.id} attempted to resolve ${req.id} without admin role/permission`);
        return;
      }

      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID).catch(() => null);

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`link_accept_${req.id}`).setStyle(ButtonStyle.Success).setEmoji('✅').setLabel('Approve').setDisabled(true),
        new ButtonBuilder().setCustomId(`link_reject_${req.id}`).setStyle(ButtonStyle.Danger).setEmoji('❌').setLabel('Reject').setDisabled(true)
      );

      if (action === 'accept') {
        const targetId = req.targetId || req.requesterId;
        const entry = accounts[targetId] || { username: req.targetTag, id: targetId, igns: [] };
        if (!entry.igns.includes(req.ign)) entry.igns.push(req.ign);
        accounts[targetId] = entry;
        writeJson(ACCOUNTS_FILE, accounts);

        req.status = 'approved';
        req.resolvedBy = interaction.user.id;
        req.resolvedAt = Date.now();
        writeJson(PENDING_FILE, pending);
        info(`Request ${req.id} approved by ${interaction.user.id}; linked ${req.ign} to ${targetId}`);

        try {
          if (adminChannel) {
            const msg = await adminChannel.messages.fetch(req.messageId).catch(() => null);
            const updatedEmbed = createEmbedForReq(req, 'approved');
            if (msg) await msg.edit({ embeds: [updatedEmbed], components: [disabledRow] });
          }
        } catch (e) { warn(`Could not edit admin message for ${req.id}: ${e}`); }

        await interaction.reply({ content: `Approved. ${req.targetTag} linked to IGN ${req.ign}`, ephemeral: true });
      } else {
        req.status = 'rejected';
        req.resolvedBy = interaction.user.id;
        req.resolvedAt = Date.now();
        writeJson(PENDING_FILE, pending);
        info(`Request ${req.id} rejected by ${interaction.user.id}`);

        try {
          if (adminChannel) {
            const msg = await adminChannel.messages.fetch(req.messageId).catch(() => null);
            const updatedEmbed = createEmbedForReq(req, 'rejected');
            if (msg) await msg.edit({ embeds: [updatedEmbed], components: [disabledRow] });
          }
        } catch (e) { warn(`Could not edit admin message for ${req.id}: ${e}`); }

        await interaction.reply({ content: `Rejected request for ${req.targetTag}.`, ephemeral: true });
      }
    }
  } catch (err) {
    errorLog(`Interaction handler error: ${err}`);
    try {
      if (interaction && !interaction.replied) await interaction.reply({ content: 'An error occurred handling that interaction.', ephemeral: true });
    } catch (e) { errorLog(`Failed to send error reply: ${e}`); }
  }
});

process.on('SIGINT', async () => {
  info('Shutting down...');
  try { await client.destroy(); } catch (e) { warn(`Destroy error: ${e}`); }
  process.exit(0);
});

client.login(TOKEN).catch(err => {
  errorLog(`Login failed: ${err}`);
  process.exit(1);
});