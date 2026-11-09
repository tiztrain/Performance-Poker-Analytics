// ---------- Hand history text parsing ----------
export function num(s) {
  return parseFloat(s.replace(/,/g, ''));
}

export function splitHands(text) {
  return text
    .split(/\n(?=CoinPoker Hand #)/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function parseHand(block) {
  const lines = block
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const hand = {
    id: null,
    sb: 0,
    bb: 0,
    ante: 0,
    dateStr: null,
    timeStr: null,
    tourney: null,
    maxSeats: null,
    buttonSeat: null,
    seats: [], // {num, name, stack}
    heroCards: null,
    streets: { preflop: [], flop: [], turn: [], river: [] },
    board: { flop: [], turn: null, river: null },
    currentStreet: 'preflop',
    pot: 0,
    heroFoldedOnStreet: null, // 'preflop'|'flop'|'turn'|'river'|null if never folded
    heroInvested: 0,
    summary: { totalPot: null, heroResult: 0 },
    shows: [], // {player, cards, handClass} for every "X: shows [..] (Class)" line, any player
    collections: [], // {player, amount} for every "X collected Y from pot" line, any player
    antes: {}, // player -> ante posted (a short stack can post less than the full ante)
    raw: block,
  };
  let streetContrib = {}; // player -> amount committed THIS street (resets each street)
  function resetStreetContrib() {
    streetContrib = {};
  }
  function addContrib(player, newTotal) {
    const prev = streetContrib[player] || 0;
    const delta = newTotal - prev;
    streetContrib[player] = newTotal;
    hand.pot += delta;
    if (player === 'Hero') hand.heroInvested += delta;
    return delta;
  }

  for (const line of lines) {
    let m;

    if (
      (m = line.match(
        /^CoinPoker Hand #(\d+): NLH \(([\d,.]+)\/([\d,.]+)\/([\d,.]+)\)(?:\s+(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2}))?/,
      ))
    ) {
      hand.id = m[1];
      hand.sb = num(m[2]);
      hand.bb = num(m[3]);
      hand.ante = num(m[4]);
      if (m[5]) {
        hand.dateStr = m[5];
        hand.timeStr = m[6];
      }
      continue;
    }
    if ((m = line.match(/^Tournament '(.+)' '(\d+)' (\d+)-max Seat #(\d+) is the button/))) {
      hand.tourney = m[1];
      hand.tourneyId = m[2];
      hand.maxSeats = parseInt(m[3]);
      hand.buttonSeat = parseInt(m[4]);
      continue;
    }
    if ((m = line.match(/^Seat (\d+): (\S+) \(([\d,.]+) in chips\)/))) {
      hand.seats.push({ num: parseInt(m[1]), name: m[2], stack: num(m[3]) });
      continue;
    }
    if (line === '*** HOLE CARDS ***') {
      continue;
    }
    if (line === '*** SHOWDOWN ***') {
      continue;
    }
    if (line === '*** SUMMARY ***') {
      hand.currentStreet = 'summary';
      continue;
    }

    if ((m = line.match(/^\*\*\* FLOP \*\*\* \[(.+)\]$/))) {
      hand.board.flop = m[1].split(' ');
      hand.currentStreet = 'flop';
      resetStreetContrib();
      continue;
    }
    if ((m = line.match(/^\*\*\* TURN \*\*\* \[.+\] \[(.+)\]$/))) {
      hand.board.turn = m[1];
      hand.currentStreet = 'turn';
      resetStreetContrib();
      continue;
    }
    if ((m = line.match(/^\*\*\* RIVER \*\*\* \[.+\] \[(.+)\]$/))) {
      hand.board.river = m[1];
      hand.currentStreet = 'river';
      resetStreetContrib();
      continue;
    }

    if ((m = line.match(/^Dealt to Hero \[(.+)\]$/))) {
      hand.heroCards = m[1].split(' ');
      continue;
    }
    if (/^Dealt to /.test(line)) continue;

    if (hand.currentStreet === 'summary') {
      if ((m = line.match(/^Total pot ([\d,.]+)/))) hand.summary.totalPot = num(m[1]);
      // The SUMMARY section reports a player's hole cards ("Seat N: player showed [..] and
      // won/lost...") in plenty of hands that never get a "*** SHOWDOWN ***"-section "X: shows
      // [..]" line at all - most commonly an uncontested pot, where the winner's own cards are
      // still known and reported even though nobody had to show. Only add it if we don't already
      // have that player's cards from the showdown section, so this only fills real gaps.
      if ((m = line.match(/^Seat \d+: (\S+) showed \[(.+)\] and (?:won \([\d,.]+\)|lost)(?: with (.+))?$/))) {
        const player = m[1];
        if (!hand.shows.some(sh => sh.player === player)) {
          hand.shows.push({ player, cards: m[2].split(' '), handClass: m[3] || null });
          if (player === 'Hero') hand.heroShownClass = m[3] || hand.heroShownClass;
        }
      }
      continue;
    }

    // Action lines
    if ((m = line.match(/^(\S+): posts ante ([\d,.]+)$/))) {
      const amt = num(m[2]);
      hand.pot += amt;
      hand.antes[m[1]] = (hand.antes[m[1]] || 0) + amt;
      if (m[1] === 'Hero') hand.heroInvested += amt;
      continue;
    }
    if ((m = line.match(/^(\S+): posts (?:small|big) blind ([\d,.]+)$/))) {
      const amt = num(m[2]);
      addContrib(m[1], amt);
      hand.streets.preflop.push({ player: m[1], action: 'post', amount: amt });
      continue;
    }
    if ((m = line.match(/^(\S+): folds$/))) {
      const foldEntry = { player: m[1], action: 'fold', potBefore: hand.pot };
      if (m[1] === 'Hero') {
        const heroContrib = streetContrib['Hero'] || 0;
        const otherContribs = Object.entries(streetContrib)
          .filter(([p]) => p !== 'Hero')
          .map(([, v]) => v);
        const maxOther = otherContribs.length ? Math.max(...otherContribs) : 0;
        foldEntry.toCall = Math.max(0, maxOther - heroContrib);
      }
      hand.streets[hand.currentStreet].push(foldEntry);
      if (m[1] === 'Hero' && hand.heroFoldedOnStreet === null) hand.heroFoldedOnStreet = hand.currentStreet;
      continue;
    }
    if ((m = line.match(/^(\S+): checks$/))) {
      hand.streets[hand.currentStreet].push({ player: m[1], action: 'check', potBefore: hand.pot });
      continue;
    }
    if ((m = line.match(/^(\S+): calls ([\d,.]+)$/))) {
      const amt = num(m[2]);
      const potBefore = hand.pot;
      addContrib(m[1], (streetContrib[m[1]] || 0) + amt);
      hand.streets[hand.currentStreet].push({ player: m[1], action: 'call', amount: amt, potBefore });
      continue;
    }
    if ((m = line.match(/^(\S+): bets ([\d,.]+)$/))) {
      const amt = num(m[2]);
      const potBefore = hand.pot;
      addContrib(m[1], (streetContrib[m[1]] || 0) + amt);
      hand.streets[hand.currentStreet].push({ player: m[1], action: 'bet', amount: amt, potBefore });
      continue;
    }
    if ((m = line.match(/^(\S+): raises ([\d,.]+) to ([\d,.]+)$/))) {
      const toAmt = num(m[3]);
      const potBefore = hand.pot;
      addContrib(m[1], toAmt);
      hand.streets[hand.currentStreet].push({
        player: m[1],
        action: 'raise',
        raiseBy: num(m[2]),
        to: toAmt,
        potBefore,
      });
      continue;
    }
    // CoinPoker reports an all-in as its own verb ("Player: ALLIN 256.75") instead of
    // "bets"/"calls"/"raises to" - the number is the INCREMENTAL amount added this action
    // (same convention as "calls"/"bets"), not a new street total. Classify it as a bet,
    // call, or raise by comparing the resulting total to what everyone else has in this
    // street, so cbet/check-raise/3-bet detection still recognize an all-in continuation
    // bet or an all-in check-raise for what it functionally is.
    if ((m = line.match(/^(\S+): ALLIN ([\d,.]+)$/))) {
      const amt = num(m[2]);
      const potBefore = hand.pot;
      const player = m[1];
      const prevContrib = streetContrib[player] || 0;
      let othersMax = 0;
      Object.entries(streetContrib).forEach(([p, v]) => {
        if (p !== player && v > othersMax) othersMax = v;
      });
      const newTotal = prevContrib + amt;
      addContrib(player, newTotal);
      const entry = { player, potBefore, allin: true };
      if (othersMax === 0) {
        entry.action = 'bet';
        entry.amount = amt;
      } else if (newTotal > othersMax) {
        entry.action = 'raise';
        entry.raiseBy = newTotal - othersMax;
        entry.to = newTotal;
      } else {
        entry.action = 'call';
        entry.amount = amt;
      }
      hand.streets[hand.currentStreet].push(entry);
      continue;
    }
    if ((m = line.match(/^(\S+): RETURN ([\d,.]+)$/))) {
      const returnAmt = num(m[2]);
      hand.pot -= returnAmt;
      if (m[1] === 'Hero') hand.heroInvested -= returnAmt; // uncalled portion refunded - wasn't really invested
      continue;
    }
    if ((m = line.match(/^(\S+) collected ([\d,.]+) from (?:main |side )?pot$/))) {
      const amt = num(m[2]);
      hand.collections.push({ player: m[1], amount: amt });
      if (m[1] === 'Hero') hand.summary.heroResult += amt;
      continue;
    }
    if ((m = line.match(/^(\S+): shows \[(.+)\] \((.+)\)$/))) {
      hand.shows.push({ player: m[1], cards: m[2].split(' '), handClass: m[3] });
      if (m[1] === 'Hero') hand.heroShownClass = m[3];
      continue;
    }
  }
  // A genuine showdown needs 2+ players who never folded - NOT just the presence of a
  // "*** SHOWDOWN ***" text marker, which CoinPoker's export prints even for an uncontested
  // pot (everyone else folded, one player left, no cards ever compared). Counting the marker
  // text alone was inflating WTSD/W$SD by mixing in every uncontested pot hero happened to win.
  const foldedPlayers = new Set();
  ['preflop', 'flop', 'turn', 'river'].forEach(street => {
    hand.streets[street].forEach(a => {
      if (a.action === 'fold') foldedPlayers.add(a.player);
    });
  });
  const activeAtEnd = hand.seats.length - foldedPlayers.size;
  hand.reachedShowdown = activeAtEnd >= 2 && hand.heroFoldedOnStreet === null;
  const heroSeat = hand.seats.find(s => s.name === 'Hero');
  hand.heroStartStack = heroSeat ? heroSeat.stack : null;
  hand.heroStartBB = hand.heroStartStack !== null && hand.bb > 0 ? hand.heroStartStack / hand.bb : null;
  hand.heroNetChips = hand.summary.heroResult - hand.heroInvested;
  hand.heroNetBB = hand.bb > 0 ? hand.heroNetChips / hand.bb : null;
  return hand;
}

export function parseAll(text) {
  return splitHands(text).map(parseHand);
}
