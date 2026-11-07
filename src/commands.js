
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { getGuild, save } from './store.js';

const ADMIN = PermissionFlagsBits.ManageGuild;

let canReadMessages = true;

export function setCanReadMessages(value) {
  canReadMessages = value;
}

const NO_CONTENT_NOTE =
  'The bot does not have the Message Content intent. Enable it in Discord Developer Portal > Bot > Privileged Gateway Intents.';

export const commands = [
  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Configure o sistema de tickets')
    .setDefaultMemberPermissions(ADMIN)
    .addChannelOption(o =>
      o.setName('category')
        .setDescription('Categoria onde os tickets serão criados')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('role')
        .setDescription('Cargo autorizado a atender os tickets')
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('log')
        .setDescription('Canal para registros de tickets fechados')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Mensagem adicional nos tickets')
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Publica o painel de atendimento do Skyz')
    .setDefaultMemberPermissions(ADMIN),

  new SlashCommandBuilder()
    .setName('ticket-add')
    .setDescription('Adiciona alguém ao ticket')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Pessoa que terá acesso')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ticket-close')
    .setDescription('Fecha o ticket atual'),
].map(c => c.toJSON());

const TICKET_NAME = /^ticket-/;

const TICKET_TYPES = {
  denuncia: {
    label: '🚨 Denúncias',
    channel: 'ticket-denuncia',
    message:
      '🚨 **CENTRAL DE DENÚNCIAS — SKYZ**\n\nExplique o ocorrido e envie as provas necessárias. A administração irá analisar sua denúncia.',
  },

  recrutamento: {
    label: '🛡️ Recrutamento Staff',
    channel: 'ticket-recrutamento',
    message:
      '🛡️ **RECRUTAMENTO STAFF — SKYZ**\n\nApresente sua candidatura e explique por que deseja fazer parte da equipe. Aguarde a avaliação da administração.',
  },
};

export async function handleCommand(interaction) {
  const settings = await getGuild(interaction.guildId);

  if (interaction.commandName === 'ticket-setup') {
    settings.categoryId =
      interaction.options.getChannel('category').id;

    settings.supportRoleId =
      interaction.options.getRole('role').id;

    const log = interaction.options.getChannel('log');

    if (log) settings.logChannelId = log.id;

    const message = interaction.options.getString('message');

    if (message) settings.welcome = message;

    await save();

    await interaction.reply({
      content:
        `Configuração salva!\nCategoria: <#${settings.categoryId}>\nCargo de atendimento: <@&${settings.supportRoleId}>` +
        (settings.logChannelId
          ? `\nRegistros: <#${settings.logChannelId}>`
          : ''),
      ephemeral: true,
    });

    return;
  }

  if (interaction.commandName === 'ticket-panel') {
    if (!settings.categoryId || !settings.supportRoleId) {
      await interaction.reply({
        content: 'Execute /ticket-setup antes de publicar o painel.',
        ephemeral: true,
      });
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_ticket:denuncia')
        .setLabel('Denúncias')
        .setEmoji('🚨')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId('open_ticket:recrutamento')
        .setLabel('Recrutamento Staff')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle('Central de Ajuda — Skyz')
      .setDescription(
        'Escolha abaixo o tipo de atendimento desejado.\n\n' +
        '🚨 **Denúncias**\n' +
        'Denuncie jogadores ou membros e envie suas provas.\n\n' +
        '🛡️ **Recrutamento Staff**\n' +
        'Envie sua candidatura para entrar na equipe de administração.\n\n' +
        'A administração irá atender sua solicitação em um canal privado.'
      )
      .setColor(0x202020);

    await interaction.channel.send({
      embeds: [embed],
      components: [row],
    });

    await interaction.reply({
      content: 'Painel do Skyz publicado com sucesso!',
      ephemeral: true,
    });

    return;
  }

  if (interaction.commandName === 'ticket-add') {
    if (!TICKET_NAME.test(interaction.channel?.name ?? '')) {
      await interaction.reply({
        content: 'Use este comando dentro de um ticket.',
        ephemeral: true,
      });
      return;
    }

    const user = interaction.options.getUser('user');

    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });

    await interaction.reply({
      content: `<@${user.id}> agora tem acesso a este ticket.`,
    });

    return;
  }

  if (interaction.commandName === 'ticket-close') {
    if (!TICKET_NAME.test(interaction.channel?.name ?? '')) {
      await interaction.reply({
        content: 'Use este comando dentro de um ticket.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: 'Fechando este ticket...',
    });

    await closeTicket(interaction.channel, interaction.user, settings);
  }
}

export async function handleButton(interaction) {
  const settings = await getGuild(interaction.guildId);

  if (interaction.customId.startsWith('open_ticket:')) {
    const type = interaction.customId.split(':')[1];
    const ticketType = TICKET_TYPES[type];

    if (!ticketType) return;

    if (!settings.categoryId || !settings.supportRoleId) {
      await interaction.reply({
        content: 'O sistema ainda não foi configurado pela administração.',
        ephemeral: true,
      });
      return;
    }

    const existing = settings.open[interaction.user.id];

    if (existing && interaction.guild.channels.cache.has(existing)) {
      await interaction.reply({
        content: `Você já possui um ticket aberto: <#${existing}>.`,
        ephemeral: true,
      });
      return;
    }

    settings.counter += 1;

    const channel = await interaction.guild.channels.create({
      name: `${ticketType.channel}-${String(settings.counter).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent: settings.categoryId,
      topic: `${ticketType.label} | Ticket de ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: settings.supportRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
    });

    settings.open[interaction.user.id] = channel.id;
    await save();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Fechar ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@${interaction.user.id}> <@&${settings.supportRoleId}>`,
      embeds: [
        new EmbedBuilder()
          .setTitle(ticketType.label)
          .setDescription(
            ticketType.message +
            (settings.welcome ? `\n\n${settings.welcome}` : '')
          )
          .setColor(0x202020),
      ],
      components: [closeRow],
    });

    await interaction.reply({
      content: `Seu ticket de ${ticketType.label} foi criado: <#${channel.id}>.`,
      ephemeral: true,
    });

    return;
  }

  if (interaction.customId === 'close_ticket') {
    if (!TICKET_NAME.test(interaction.channel?.name ?? '')) {
      await interaction.reply({
        content: 'Este canal não é um ticket válido.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Ticket fechado por <@${interaction.user.id}>.`,
    });

    await closeTicket(interaction.channel, interaction.user, settings);
  }
}

async function closeTicket(channel, closedBy, settings) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);

  const lines = messages
    ? [...messages.values()]
        .reverse()
        .map(m =>
          `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content || ''}` +
          (m.attachments.size
            ? ` (${[...m.attachments.values()].map(a => a.url).join(' ')})`
            : '')
        )
    : ['(transcript unavailable)'];

  const note = canReadMessages ? '' : `${NO_CONTENT_NOTE}\n\n`;

  const owner = Object.entries(settings.open)
    .find(([, id]) => id === channel.id)?.[0];

  if (owner) delete settings.open[owner];

  await save();

  if (settings.logChannelId) {
    const log = channel.guild.channels.cache.get(settings.logChannelId);

    if (log) {
      const file = new AttachmentBuilder(
        Buffer.from(note + lines.join('\n'), 'utf8'),
        { name: `${channel.name}.txt` }
      );

      await log.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${channel.name} fechado`)
            .setDescription(
              `Aberto por ${owner ? `<@${owner}>` : 'desconhecido'}, fechado por <@${closedBy.id}>. ${lines.length} mensagens.`
            )
            .setColor(0xed4245)
            .setTimestamp(),
        ],
        files: [file],
      }).catch(err =>
        console.error('[ticket-bot] transcript not posted:', err.message)
      );
    }
  }

  setTimeout(() => {
    channel.delete('Ticket fechado').catch(() => {});
  }, 5000);
  }
  
