async function closeTicket(channel, closedBy, settings) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);

  const lines = messages
    ? [...messages.values()].reverse().map(m =>
        `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content || ''}` +
        (m.attachments.size
          ? ` (${[...m.attachments.values()].map(a => a.url).join(' ')})`
          : '')
      )
    : ['(transcrição indisponível)'];

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
        console.error('[ticket-bot] erro ao enviar transcrição:', err.message)
      );
    }
  }

  setTimeout(() => {
    channel.delete('Ticket fechado').catch(() => {});
  }, 5000);
}
