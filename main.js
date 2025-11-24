/*
  Single-file Discord bot implementing a /link command that:
  - sends a request message with ✅/❌ buttons to the AdminLogs channel (configured in config.json)
  - persists pending requests across restarts (pending.json)
  - persists approved account links (accounts.json)
  - disables buttons after a decision
  Notes:
  - npm install discord.js dotenv
  - Put token in .env: DISCORD_TOKEN=your_token_here
  - Provide config.json with at least: { "AdminLogs": "CHANNEL_ID", "GUILD_ID": "optional_guild_id" }
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationCommandOptionType } = require('discord.js');

const DATA_DIR = path.resolve(__dirname);
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

let config = {};
try { config = require('./config.json'); } catch {}
const TOKEN = process.env.DISCORD_TOKEN || config.DISCORD_TOKEN;
const GUILD_ID = config.GUILD_ID || process.env.GUILD_ID;
// replaced how ADMIN_CHANNEL_ID is resolved to accept both shapes
const ADMIN_CHANNEL_ID =
  process.env.ADMIN_CHANNEL_ID ||
  config.AdminLogs ||
  (config.channelIDs && config.channelIDs.AdminLogs);
if (!TOKEN) {
  console.error('ERROR: DISCORD_TOKEN not set. Add DISCORD_TOKEN to .env or config.json');
  process.exit(1);
}
if (!ADMIN_CHANNEL_ID) {
  console.error('ERROR: AdminLogs not configured in config.json (must be a channel ID).');
  // not exiting: bot can still run but /link will error when used
}

function readJson(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || 'null') || defaultValue;
  } catch (e) {
    console.error('Failed to read', filePath, e);
    return defaultValue;
  }
}
function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write', filePath, e);
  }
}

let pending = readJson(PENDING_FILE, []); // array of pending requests
let accounts = readJson(ACCOUNTS_FILE, {}); // map: discordId -> { username, id, igns: [] }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const linkCommand = {
  name: 'link',
  description: 'Request admin approval to link a Minecraft IGN to a Discord account',
  options: [
    { name: 'ign', description: 'Minecraft in-game name', type: ApplicationCommandOptionType.String, required: true },
    { name: 'account', description: 'Discord account to link (if different)', type: ApplicationCommandOptionType.User, required: false }
  ]
};

client.once(Events.ClientReady, async () => {
  console.log(`Connected. Logged in as ${client.user.tag}`);

  // register slash command (guild if provided for fast registration)
  try {
    if (GUILD_ID) {
      const guild = await client.guilds.fetch(GUILD_ID);
      await guild.commands.create(linkCommand);
      console.log('Registered /link to guild', GUILD_ID);
    } else {
      await client.application.commands.create(linkCommand);
      console.log('Registered /link globally (may take up to an hour)');
    }
  } catch (err) {
    console.error('Failed to register command:', err);
  }

  // restore pending messages in AdminLogs if necessary
  if (ADMIN_CHANNEL_ID) {
    try {
      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
      if (!adminChannel || !adminChannel.isTextBased()) {
        console.warn('AdminLogs channel not a text channel or not found:', ADMIN_CHANNEL_ID);
      } else {
        // For each pending request ensure a message exists. If saved messageId is missing or message deleted -> resend and update messageId.
        for (const req of pending.filter(p => p.status === 'pending')) {
          let message;
          if (req.messageId) {
            try {
              message = await adminChannel.messages.fetch(req.messageId);
            } catch {}
          }
          if (!message) {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`link_accept_${req.id}`).setStyle(ButtonStyle.Success).setEmoji('✅').setLabel('Approve'),
              new ButtonBuilder().setCustomId(`link_reject_${req.id}`).setStyle(ButtonStyle.Danger).setEmoji('❌').setLabel('Reject')
            );
            const content = `Do you allow <@${req.requesterId}> (${req.requesterTag}) to link IGN \`${req.ign}\`${req.targetId ? ` to <@${req.targetId}> (${req.targetTag})` : ''}?`;
            const sent = await adminChannel.send({ content, components: [row] });
            req.messageId = sent.id;
            writeJson(PENDING_FILE, pending);
            console.log('Restored pending request message for', req.id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to restore pending messages:', err);
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

      // send to admin logs
      if (!ADMIN_CHANNEL_ID) {
        await interaction.reply({ content: 'AdminLogs not configured on the bot. Contact the bot owner.', ephemeral: true });
        return;
      }
      const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID).catch(() => null);
      if (!adminChannel || !adminChannel.isTextBased()) {
        await interaction.reply({ content: 'AdminLogs channel not found or not a text channel. Contact the bot owner.', ephemeral: true });
        return;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`link_accept_${reqId}`).setStyle(ButtonStyle.Success).setEmoji('✅').setLabel('Approve'),
        new ButtonBuilder().setCustomId(`link_reject_${reqId}`).setStyle(ButtonStyle.Danger).setEmoji('❌').setLabel('Reject')
      );

      const content = `Do you allow <@${req.requesterId}> (${req.requesterTag}) to link IGN \`${ign}\`${req.targetId && req.targetId !== req.requesterId ? ` to <@${req.targetId}> (${req.targetTag})` : ''}?`;
      const sent = await adminChannel.send({ content, components: [row] });
      req.messageId = sent.id;
      writeJson(PENDING_FILE, pending);

      await interaction.reply({ content: 'Link request submitted to admins.', ephemeral: true });
    }

    if (interaction.isButton()) {
      const cid = interaction.customId;
      if (!cid.startsWith('link_accept_') && !cid.startsWith('link_reject_')) return;
      const [ , action, reqId ] = cid.split('_'); // e.g., ['link','accept','123']
      const req = pending.find(p => p.id === reqId);
      if (!req) {
        await interaction.reply({ content: 'Request not found (may have expired).', ephemeral: true });
        return;
      }
      if (req.status !== 'pending') {
        await interaction.reply({ content: `This request was already ${req.status}.`, ephemeral: true });
        return;
      }

      if (action === 'accept') {
        // save to accounts.json under targetId
        const targetId = req.targetId || req.requesterId;
        const entry = accounts[targetId] || { username: req.targetTag, id: targetId, igns: [] };
        if (!entry.igns.includes(req.ign)) entry.igns.push(req.ign);
        accounts[targetId] = entry;
        writeJson(ACCOUNTS_FILE, accounts);
        req.status = 'approved';
        req.resolvedBy = interaction.user.id;
        req.resolvedAt = Date.now();
        writeJson(PENDING_FILE, pending);

        // disable buttons
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`link_accept_${req.id}`).setStyle(ButtonStyle.Success).setEmoji('✅').setLabel('Approve').setDisabled(true),
          new ButtonBuilder().setCustomId(`link_reject_${req.id}`).setStyle(ButtonStyle.Danger).setEmoji('❌').setLabel('Reject').setDisabled(true)
        );
        try {
          const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
          const msg = await adminChannel.messages.fetch(req.messageId).catch(() => null);
          if (msg) await msg.edit({ content: `${msg.content}\n\n✅ Approved by <@${interaction.user.id}>`, components: [disabledRow] });
        } catch (e) { console.warn('Could not edit admin message:', e); }

        await interaction.reply({ content: `Approved. ${req.targetTag} linked to IGN ${req.ign}`, ephemeral: true });
      } else {
        // reject
        req.status = 'rejected';
        req.resolvedBy = interaction.user.id;
        req.resolvedAt = Date.now();
        writeJson(PENDING_FILE, pending);

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`link_accept_${req.id}`).setStyle(ButtonStyle.Success).setEmoji('✅').setLabel('Approve').setDisabled(true),
          new ButtonBuilder().setCustomId(`link_reject_${req.id}`).setStyle(ButtonStyle.Danger).setEmoji('❌').setLabel('Reject').setDisabled(true)
        );
        try {
          const adminChannel = await client.channels.fetch(ADMIN_CHANNEL_ID);
          const msg = await adminChannel.messages.fetch(req.messageId).catch(() => null);
          if (msg) await msg.edit({ content: `${msg.content}\n\n❌ Rejected by <@${interaction.user.id}>`, components: [disabledRow] });
        } catch (e) { console.warn('Could not edit admin message:', e); }

        await interaction.reply({ content: `Rejected request for ${req.targetTag}.`, ephemeral: true });
      }
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    try {
      if (interaction && !interaction.replied) await interaction.reply({ content: 'An error occurred handling that interaction.', ephemeral: true });
    } catch {}
  }
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  try { await client.destroy(); } catch {}
  process.exit(0);
});

client.login(TOKEN).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});