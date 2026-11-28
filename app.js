/* Hôtel des ventes Forever, interface version 2 (jeux/wow-forever/hv-site/site-v2).
   Une seule page, routage par l'ancre de l'adresse, données JSON statiques du dossier data/, aucune dépendance :
   les graphiques sont dessinés en SVG. Langage visuel : hv-site/maquette/maquette.html.
   Adresses : #/accueil  #/classement?periode=g-7&classe=&sc=&tri=valeur&q=  #/objet/<id>?fenetre=30
              #/artisanat?metier=&tri=gain&niveau=&tous=&q=  #/recette/<spell>  #/farm?type=&metier=&classe=&tri=&q=
              #/recherche?q=  #/mes-objets  #/methode  #/faveur?metier=&tri=&etat=&vue=&q=
   Champs récents des données, tous facultatifs (un bloc dont la donnée manque n'est pas affiché) :
   data/courbes.json, meta.marche, et dans objets/<id>.json : conseil, heures, profil_heures, profondeur, paliers, fourchette. */
"use strict";
(() => {
  const D = { meta: null, index: [], parId: new Map(), cache: new Map(), graphiques: [], courbes: null, v14: new Map(), jeton: 0, surTri: null, rafraichir: null };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const VIDE = "–", ND = `<span class="nd">${VIDE}</span>`, NBSP = "\u00a0";
  const nb = (x) => x != null && x !== "" && Number.isFinite(Number(x));
  const fmtN = (x, d = 0) => nb(x) ? Number(x).toLocaleString("fr-FR", { maximumFractionDigits: d }) : VIDE;
  const fmtQ = (x) => fmtN(x, nb(x) && Math.abs(x) < 10 ? 1 : 0);
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const WH = (id) => `https://www.wowhead.com/forever/item=${id}`;
  const WHS = (s) => `https://www.wowhead.com/forever/spell=${s}`;
  const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const JOURS_C = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const TYPES_FARM = { recolte: "Récolte", peche: "Pêche", butin: "Butin de créatures", autre: "Autres butins" };
  const QUAL = { Mauvais: "mauvais", Commun: "commun", Inhabituel: "inhabituel", Rare: "rare", Epique: "epique" };
  const QUAL_LIB = { Mauvais: "Médiocre", Commun: "Commun", Inhabituel: "Inhabituel", Rare: "Rare", Epique: "Épique" };
  const qcl = (q) => "q-" + (QUAL[q] || "commun");
  /* Ventes soutenues : le seuil des blocs de l'accueil (unités et cuivre par jour sur 7 jours, munitions exclues). */
  const SEUIL = { vj: 150, valj: 3000000, manque_h: 6 };
  const C = { med: "var(--serie-1)", pl: "var(--serie-2)", vendus: "var(--serie-3)", dep: "var(--serie-3b)", neutre: "var(--serie-n)" };

  // ------------------------------------------------------------------ formats
  function dateFr(j, court = false) {
    if (!j) return VIDE;
    const d = new Date(j + "T12:00:00"), n = d.getDate() === 1 ? "1er" : d.getDate();
    return court ? `${JOURS_C[d.getDay()]} ${n} ${MOIS_C[d.getMonth()]}` : `${JOURS[d.getDay()]} ${n} ${MOIS[d.getMonth()]}`;
  }
  const dateCourt = (j) => j.slice(8, 10) + "/" + j.slice(5, 7);
  /* Journées de collecte incomplète sautées entre deux journées complètes : la comparaison dit pourquoi elle saute un jour. */
  const ecartees = (js, prec, der) => {
    const l = prec && der ? (js || []).filter((j) => j.jour > prec.jour && j.jour < der.jour && !j.complet) : [];
    const t = l.map((j) => `${dateFr(j.jour)} est écarté de la comparaison : collecte incomplète, ${heuresTxt(j.heures)} relevées sur 24`).join(" ; ");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) + "." : "";
  };
  const noteEcartees = (js, prec, der) => { const t = ecartees(js, prec, der); return t ? `<span class="note-ec">${esc(t)}</span>` : ""; };
  const heuresTxt = (x) => nb(x) ? fmtN(x, 1) + NBSP + "h" : VIDE;
  /* Temps de recharge d'une recette (heures ; 0 : recharge connue, durée non lue). */
  const dureeRecharge = (h) => !h ? "" : h < 1 ? `${fmtN(60 * h)}${NBSP}min` : h < 24 ? `${fmtN(h, 1)}${NBSP}h` : `${fmtN(h / 24, 1)}${NBSP}j`;
  const cadenceRecharge = (h) => !h ? "durée de la recharge à relever" : h === 1 ? "une fabrication par heure" : h < 20 ? `une fabrication toutes les ${dureeRecharge(h)}` : h < 36 ? "une fabrication par jour" : `une fabrication tous les ${fmtN(h / 24)}${NBSP}jours`;
  const etqRecharge = (h) => h == null ? "" : `<span class="etq-r" title="${h ? `Recette à temps de recharge : ${esc(cadenceRecharge(h))} et par personnage. Le gain par jour en tient compte.` : "Recette à temps de recharge, dont la durée reste à relever : son gain par jour n'est pas chiffré."}">recharge${h ? NBSP + dureeRecharge(h) : ""}</span>`;
  /* Camp des recettes : une recette dont l'objet qui l'enseigne (plan, patron, formule, recette, schéma) n'est accessible
     qu'à un camp. camp : « alliance », « horde », « inconnu » (aucune source connue), « neutre » ou vide (pas encore relevé). */
  const CAMPS = { alliance: "Alliance", horde: "Horde" }, CAMPS_DE = { alliance: "l'Alliance", horde: "la Horde" };
  const MOTS_PLAN = [["Plans:", "Plan"], ["Pattern:", "Patron"], ["Formula:", "Formule"], ["Schematic:", "Schéma"], ["Recipe:", "Recette"]];
  const MOT_METIER = { 164: "Plan", 165: "Patron", 197: "Patron", 333: "Formule", 202: "Schéma" };
  const motPlan = (metier, nom) => { const m = MOTS_PLAN.find(([p]) => String(nom || "").startsWith(p)); return m ? m[1] : MOT_METIER[metier] || "Recette"; };
  /* Sources d'un objet-recette en une ligne : quêtes avec leur camp, marchands avec le camp qu'ils servent, butin. */
  function sourcesCamp(s) {
    if (!s) return "";
    const sert = (a, h) => { const ca = a != null && a >= 0, ch = h != null && h >= 0; return ca && ch ? "les deux camps" : ca ? "Alliance" : ch ? "Horde" : "aucun camp"; };
    const q = (s.quetes || []).map(([, side, nom]) => `quête ${nom} (${side === 1 ? "Alliance" : side === 2 ? "Horde" : "les deux camps"})`);
    const mm = s.marchands || [], m = mm.slice(0, 3).map(([, a, h, nom]) => `marchand ${nom} (${sert(a, h)})`);
    if (mm.length > 3) m.push(`${fmtN(mm.length - 3)} autre${mm.length > 4 ? "s" : ""} marchand${mm.length > 4 ? "s" : ""}`);
    return [...q, ...m, ...(s.butin ? [`butin de ${fmtN(s.butin)} monstre${s.butin > 1 ? "s" : ""}`] : [])].join(", ");
  }
  /* Hors de portée du lecteur : le plan est réservé à l'autre camp que le sien. Sans camp choisi, rien n'est hors de portée. */
  const horsCamp = (camp) => (camp === "alliance" || camp === "horde") && monCamp !== "tous" && camp !== monCamp;
  const etqCamp = (camp, metier, lien, info) => {
    if (camp === "inconnu") return '<span class="etq-i" title="Wowhead Forever ne connaît aucune source à cette recette : ni quête, ni marchand, ni butin. Ce n\'est pas un piège établi.">source inconnue</span>';
    if (camp !== "alliance" && camp !== "horde") return "";
    const mot = motPlan(metier, info && info.nom), src = sourcesCamp(info && info.sources);
    const t = `${mot} que seule ${CAMPS_DE[camp]} peut obtenir${src ? " : " + src : ""}. ${lien === "bop" ? "Lié quand ramassé : introuvable pour l'autre camp." : "Non lié : l'autre camp ne l'obtient qu'en l'achetant à un joueur."}`;
    return `<span class="etq-c${horsCamp(camp) || monCamp === "tous" ? "" : " mien"}" title="${esc(t)}">${mot.toLowerCase()} ${CAMPS[camp]} seulement</span>`;
  };
  /* Avis de camp, en clair, sur la page d'une recette, d'un objet fabriqué ou du plan lui-même (soi). */
  function avisCamp({ camp, lien, plan, metier, info, recette, soi, enseigne }) {
    if (camp !== "alliance" && camp !== "horde" && camp !== "inconnu") return "";
    const mot = motPlan(metier, info && info.nom), nomPlan = (info && info.nom) || `${mot.toLowerCase()} ${plan}`;
    const lienPlan = soi ? `ce ${mot.toLowerCase() === "recette" ? "parchemin de recette" : mot.toLowerCase()}` : plan && D.parId.has(plan) ? `<a href="#/objet/${plan}">${esc(nomPlan)}</a>` : plan ? `<a href="${WH(plan)}" target="_blank" rel="noopener">${esc(nomPlan)} ↗</a>` : esc(nomPlan);
    const pour = recette ? `<i>${esc(recette)}</i> : ` : "", suite = enseigne ? ` Il enseigne ${enseigne}.` : "";
    if (camp === "inconnu") return `<p class="avis-c inconnu"><b>Source inconnue.</b> ${pour}Wowhead Forever ne connaît aucune source à ${lienPlan} : ni quête, ni marchand, ni butin. Ce n'est pas un piège établi, mais rien ne dit comment l'apprendre.${suite}</p>`;
    const src = sourcesCamp(info && info.sources), hors = horsCamp(camp);
    /* Le plan lui-même se vend-il ici ? C'est ce qui décide, pour l'autre camp, entre un piège et un achat. */
    const op = plan && lien !== "bop" ? D.parId.get(plan) : null;
    const ici = lien === "bop" ? "" : op && op.st > 0 && nb(op.pl) ? ` Il est en vente à cet hôtel des ventes : ${fmtN(op.st)} en vente, à partir de ${prixTexte(op.pl)}.`
      : op ? ` Il a déjà été vu à cet hôtel des ventes, aucun en vente au dernier relevé.` : ` Il n'a jamais été vu à cet hôtel des ventes.`;
    return `<p class="avis-c${hors || monCamp === "tous" ? "" : " mien"}"><b>${mot} ${CAMPS[camp]} seulement${hors ? " : un piège pour " + CAMPS_DE[monCamp] : ""}.</b> ${pour}${pour ? "seule" : "Seule"} ${CAMPS_DE[camp]} peut obtenir ${lienPlan}.${src ? ` Source : ${esc(src)}.` : ""} ${lien === "bop" ? "Il est lié quand ramassé : introuvable pour l'autre camp." : "Il n'est pas lié : l'autre camp ne l'obtient qu'en l'achetant à un joueur."}${ici}${suite}</p>`;
  }
  /* Comment apprendre une recette (data/apprendre.json, 23/11/2026) : du chemin le plus simple au plus long, et seulement
     ce qui existe. Connue d'office, formateur, puis l'objet qui l'enseigne : en vente à cet hôtel des ventes, chez un
     marchand (zone, camp servi, prix, stock, réputation exigée), en récompense de quête, en butin. Les noms de zones et
     de factions du relevé sont anglais : ceux du jeu en français quand ils sont connus, l'anglais sinon. */
  const ZONES_FR = { Duskwood: "Bois de la Pénombre", Wetlands: "Les Paluns", "Elwynn Forest": "Forêt d'Elwynn", "Silverpine Forest": "Forêt des Pins argentés",
    "Eastern Plaguelands": "Maleterres de l'est", "Western Plaguelands": "Maleterres de l'ouest", Darkshore: "Sombrivage", Undercity: "Fossoyeuse",
    "Dustwallow Marsh": "Marécage d'Âprefange", "Stormwind City": "Hurlevent", Ironforge: "Forgefer", "Blackrock Depths": "Profondeurs de Rochenoire",
    "Thunder Bluff": "Les Pitons du Tonnerre", "The Barrens": "Les Tarides", "Dire Maul": "Hache-Tripes", "Hillsbrad Foothills": "Contreforts de Hautebrande",
    Badlands: "Terres ingrates", "Stranglethorn Vale": "Vallée de Strangleronce", Ashenvale: "Orneval", "Ruins of Ahn'Qiraj": "Ruines d'Ahn'Qiraj", Feralas: "Féralas",
    "Alterac Mountains": "Montagnes d'Alterac", Felwood: "Gangrebois", "Blasted Lands": "Terres foudroyées", Westfall: "Marche de l'Ouest", "Thousand Needles": "Mille pointes",
    Desolace: "Désolace", "Stonetalon Mountains": "Les Serres-Rocheuses", "Redridge Mountains": "Les Carmines", "Arathi Highlands": "Hautes-terres d'Arathi",
    "Burning Steppes": "Steppes ardentes", "The Hinterlands": "Les Hinterlands", "Un'Goro Crater": "Cratère d'Un'Goro", Moonglade: "Reflet-de-Lune", "Mount Hyjal": "Mont Hyjal",
    Winterspring: "Berceau-de-l'Hiver", "Swamp of Sorrows": "Marais des Chagrins", "Tirisfal Glades": "Clairières de Tirisfal" };
  const FACTIONS_FR = { "Argent Dawn": "Aube d'argent", "Cenarion Circle": "Cercle cénarien", "Zandalar Tribe": "Tribu Zandalar", "Timbermaw Hold": "Les Grumegueules",
    "Thorium Brotherhood": "Confrérie du thorium", "Earthen Ring": "Cercle terrestre", "Hydraxian Waterlords": "Les Hydraxiens" };
  const RANGS_FR = { Neutral: "Neutre", Friendly: "Amical", Honored: "Honoré", Revered: "Révéré", Exalted: "Exalté" };
  const SPEC_FR = { Armorsmith: "Fabricant d'armures", Weaponsmith: "Fabricant d'armes", "Master Swordsmith": "Maître fabricant d'épées", "Master Axesmith": "Maître fabricant de haches",
    "Master Hammersmith": "Maître fabricant de marteaux", "Tribal Leatherworking": "Travail du cuir tribal", "Elemental Leatherworking": "Travail du cuir élémentaire",
    "Dragonscale Leatherworking": "Travail du cuir d'écailles de dragon" };
  const AUTRES_FR = { "contained-in-object": "dans un coffre ou un objet du monde", "contained-in-item": "dans un objet à ouvrir", "pick-pocketed-from": "par vol à la tire" };
  const LE_PLAN = { Plan: "le plan", Patron: "le patron", Formule: "la formule", "Schéma": "le schéma", Recette: "le parchemin de recette" };
  /* Monnaies des plans payés hors pièces (troisième relevé, 23/11/2026) : nom français quand il est sûr, anglais sinon
     (Tarnished Undermine Real est propre à Forever : pas de traduction inventée). */
  const MONNAIES_FR = { "Merchant's Favor": "Faveur de marchand" };
  /* Faveur de marchand : son identifiant de monnaie sur Wowhead Forever, et l'étiquette « Faveur 30 » d'une recette dont le
     plan s'achète en Faveur (colonne faveur de data/artisanat.json), qui mène à la page #/faveur. */
  const FAVEUR_ID = 3402;
  const etqFaveur = (q) => nb(q) ? `<a class="etq-fv" href="#/faveur" title="Le plan de cette recette s'achète ${fmtN(q)} points de Faveur de marchand, la monnaie des caisses détournées. Voir tout ce que la Faveur achète.">Faveur${NBSP}${fmtN(q)}</a>` : "";
  const WHN = (id) => `https://www.wowhead.com/forever/npc=${id}`, WHQ = (id) => `https://www.wowhead.com/forever/quest=${id}`, WHC = (id) => `https://www.wowhead.com/forever/currency=${id}`;
  const lienExt = (url, t) => `<a href="${url}" target="_blank" rel="noopener">${esc(t)}${NBSP}↗</a>`;
  const sertCamp = (a, h) => ({ a: a != null && a >= 0, h: h != null && h >= 0 });
  const campServi = (a, h) => { const s = sertCamp(a, h); return s.a && s.h ? "les deux camps" : s.a ? "Alliance seulement" : s.h ? "Horde seulement" : "aucun camp"; };
  const pasPourMoi = (a, h) => { const s = sertCamp(a, h); return monCamp === "horde" ? !s.h : monCamp === "alliance" ? !s.a : false; };
  const zoneFr = (AP, z) => { const n = z != null ? (AP.zones || {})[z] : null; return n ? ZONES_FR[n] || n : ""; };
  const deMetier = (m) => (/^[AEIOUÉH]/i.test(m) ? "d'" : "de ") + m;
  const repTexte = (rep) => !rep ? "" : `${FACTIONS_FR[rep[0]] || rep[0]}${rep[1] ? " " + (RANGS_FR[rep[1]] || rep[1]) : ""}${rep[2] ? `, spécialité ${SPEC_FR[rep[2]] || rep[2]}` : ""}`;
  /* Ce que demande un marchand pour un plan : les pièces, puis les monnaies et les objets exigés du relevé (cout).
     Rend { h: texte en HTML, or: équivalent en cuivre quand tout se chiffre, sinon null }. Un plan payé en Faveur de
     marchand reçoit son équivalent en or au cours des caisses détournées (AP.faveur : la remise la moins chère par point
     au relevé) ; un objet exigé en vente ici, son plancher. Rien n'est estimé sans ces deux sources. */
  function coutMarchand(prix, cout, AP, plan) {
    const parts = [], fav = AP.faveur; let or = prix > 0 ? prix : 0, chiffre = true;
    if (prix > 0) parts.push(`<b>${esc(prixTexte(prix))}</b>`);
    for (const [id, q] of (cout && cout.monnaies) || []) {
      const nom = (AP.monnaies || {})[id] || "monnaie " + id;
      let t = `<b>${fmtN(q)}</b>${NBSP}${lienExt(WHC(id), MONNAIES_FR[nom] || nom)}`;
      if (fav && Number(fav.monnaie) === Number(id) && nb(fav.par_point)) { or += q * fav.par_point;
        t += ` <span class="nd" title="${esc(`D'après la remise de caisse la moins chère par point au relevé du ${fav.photo || "jour"} : ${fav.caisse_nom || "caisse " + fav.caisse}, ${prixTexte(fav.remise)} la remise pour ${fmtN(fav.points)} points, soit ${prixTexte(fav.par_point)} le point. Faveur de base de la caisse, hors bonus de performance, d'après l'addon WaylaidCost : à vérifier en jeu.`)}">(soit environ ${esc(prixTexte(q * fav.par_point))} au cours des <a href="#/objet/${esc(fav.caisse)}">caisses</a>)</span>`; }
      else chiffre = false;
      parts.push(t);
    }
    for (const [id, q] of (cout && cout.objets) || []) {
      const oc = D.parId.get(Number(id)), nom = (AP.objets_cout || {})[id] || "objet " + id;
      let t = `<b>${fmtN(q)}</b>${NBSP}× ${oc ? `<a href="#/objet/${oc.id}">${esc(oc.nom)}</a>` : lienExt(WH(id), nom)}`;
      if (oc && oc.st > 0 && nb(oc.pl)) { or += q * oc.pl; t += ` <span class="nd">(en vente ici à partir de ${esc(prixTexte(oc.pl))} l'unité, soit ${esc(prixTexte(q * oc.pl))}${NBSP}: un plan achetable en or)</span>`; }
      else { chiffre = false; if (oc) t += ` <span class="nd">(déjà vu ici, aucun en vente au dernier relevé)</span>`; }
      parts.push(t);
    }
    if (!parts.length) return { h: prix === 0 ? `pas de prix en pièces${NBSP}: autre monnaie (${lienExt(WH(plan) + "#sold-by", "voir Wowhead")})` : "", or: null };
    const alt = cout && cout.alternatives > 1 ? ` ; autre prix possible (${lienExt(WH(plan) + "#sold-by", "voir Wowhead")})` : "";
    return { h: parts.join(" et ") + alt, or: chiffre && or > 0 ? or : null };
  }
  /* Chemins pour obtenir un objet-recette. ici : dire aussi s'il se vend à cet hôtel (faux sur la fiche du plan lui-même). */
  function cheminsPlan(plan, AP, { ici = true, max = 6 } = {}) {
    const p = AP && AP.plans ? AP.plans[plan] : null, op = D.parId.get(Number(plan)), out = [];
    if (ici && op && !(p && p.lien === "bop")) {
      const vj = nb(op.vj) && op.vj > 0 ? `, ${fmtQ(op.vj)} vendu${op.vj >= 2 ? "s" : ""} par jour` : "";
      out.push({ t: "Hôtel des ventes", h: op.st > 0 && nb(op.pl) ? `<a href="#/objet/${op.id}">en vente ici</a> : ${fmtN(op.st)} en vente, à partir de <b>${esc(prixTexte(op.pl))}</b>${vj}.`
        : `<a href="#/objet/${op.id}">déjà vu ici</a>, aucun en vente au dernier relevé${nb(op.mv7) ? `, médiane vendue ${esc(prixTexte(op.mv7))}` : ""}${vj}.` });
    }
    if (!p) return out;
    const rep = repTexte(p.rep);
    /* Un marchand que Wowhead donne hostile aux deux camps (Dala Fairmaw de Barkskin Burrow, Gorhak le centaure de
       Désolace) se gagne par la réputation : la ligne n'est hors de portée d'aucun camp en particulier, donc pas grisée.
       La réputation exigée en rouge dit la condition quand le relevé la connaît, « hostile par défaut » sinon. */
    const parRep = (a, h) => { const s = sertCamp(a, h); return !s.a && !s.h; };
    /* Tri : les marchands du camp du lecteur, puis le prix en pièces, ou l'équivalent en or d'un coût hors pièces
       quand il se chiffre (Faveur au cours des caisses, objet exigé en vente ici), les autres ensuite. */
    const mm = (p.marchands || []).map(([id, a, h, nom, z, stock, prix, cout]) => { const c = coutMarchand(prix, cout, AP, plan);
      return { id, a, h, nom, z, stock, cout: c.h, tri: prix > 0 ? prix : c.or ?? Infinity, hors: !parRep(a, h) && pasPourMoi(a, h), camp: parRep(a, h) ? (rep ? "" : "hostile par défaut aux deux camps") : campServi(a, h) }; })
      .sort((x, y) => x.hors - y.hors || x.tri - y.tri || String(x.nom).localeCompare(String(y.nom)));
    for (const m of mm.slice(0, max)) out.push({ t: "Marchand", hors: m.hors, h: [lienExt(WHN(m.id), m.nom || "marchand " + m.id), esc(zoneFr(AP, m.z)), m.camp, rep ? `<span class="rep">${esc(rep)}</span>` : "", m.cout,
      nb(m.stock) && m.stock > 0 ? `stock limité${NBSP}: ${fmtN(m.stock)}` : ""].filter(Boolean).join(", ") + "." });
    if (mm.length > max) { const r = mm.slice(max), n = r.filter((m) => !m.hors).length;
      out.push({ t: "", hors: !n, h: `et ${fmtN(r.length)} autre${r.length > 1 ? "s" : ""} marchand${r.length > 1 ? "s" : ""}${monCamp !== "tous" ? `, dont ${fmtN(n)} pour votre camp` : ""} (${lienExt(WH(plan) + "#sold-by", "liste sur Wowhead")}).` }); }
    /* Un marchand payé en Faveur de marchand : la page qui liste tout ce que la Faveur achète. */
    if ((p.marchands || []).some((m) => ((m[7] && m[7].monnaies) || []).some(([idM]) => Number(idM) === FAVEUR_ID)))
      out.push({ t: "Faveur", h: `<a href="#/faveur">Tout ce que la Faveur de marchand achète</a> : les plans des marchands à Faveur, leur coût et ce que vaut leur produit ici.` });
    for (const [id, side, nom] of p.quetes || []) out.push({ t: "Quête", hors: side === 1 ? monCamp === "horde" : side === 2 ? monCamp === "alliance" : false,
      h: `${lienExt(WHQ(id), nom || "quête " + id)}${side === 1 ? ", Alliance seulement" : side === 2 ? ", Horde seulement" : side === 3 ? ", les deux camps" : ""}.` });
    /* Un objet seulement en butin n'a pas eu sa fiche visitée : la liste Wowhead dit qu'il tombe, sans le compte (codes). */
    const codes = p.codes || [];
    if (p.butin > 0) out.push({ t: "Butin", h: `lâché par ${fmtN(p.butin)} monstre${p.butin > 1 ? "s" : ""} (${lienExt(WH(plan) + "#dropped-by", "liste sur Wowhead")}).` });
    else if (codes.includes(2)) out.push({ t: "Butin", h: `lâché par des monstres (${lienExt(WH(plan) + "#dropped-by", "liste sur Wowhead")}).` });
    const au = (p.autres || []).map((k) => AUTRES_FR[k]).filter(Boolean);
    if (codes.includes(16) && !(p.autres || []).includes("pick-pocketed-from")) au.push(AUTRES_FR["pick-pocketed-from"]);
    if (codes.includes(21) && !(p.autres || []).length) au.push("autre source, coffre, pêche ou objet à ouvrir");
    if (codes.includes(1)) au.push("fabriqué par un métier");
    if (au.length) out.push({ t: "Aussi", h: `${esc(au.join(", "))} (${lienExt(WH(plan), "fiche sur Wowhead")}).` });
    return out;
  }
  /* Chemins pour apprendre une recette : [{ t: étiquette, h: texte en HTML, hors: hors de portée du camp du lecteur }]. */
  function cheminsRecette(spell, AP, metier, niveau, opts = {}) {
    const r = AP && AP.recettes ? AP.recettes[spell] : null;
    if (!r) return [];
    const [fc, fn, plan, pn, mode] = r, m = metierFr(metier), out = [], so = (AP.sorts || {})[spell] || {};
    if (so.niveau > 1) niveau = so.niveau; /* niveau exigé lu sur Wowhead, quand SkillUp ne le porte pas */
    if (mode === "aucune_source") out.push({ t: "Connue d'office", h: `acquise en apprenant le métier${niveau > 1 ? ` (${esc(m)} ${fmtN(niveau)} pour la fabriquer)` : ""} : ni formateur à payer, ni objet à trouver.` });
    if (fc != null || fn != null) out.push({ t: "Formateur", h: `chez un formateur ${esc(deMetier(m))}${nb(fc) ? (fc > 0 ? `, <b>${esc(prixTexte(fc))}</b>` : ", gratuit") : ""}${nb(fn) && fn > 0 ? `, ${esc(m)} ${fmtN(fn)}` : ""}.` });
    if (mode === "formateur" && (so.formateurs || []).length) {
      const ff = so.formateurs.map(([id, nom, a, h, z]) => ({ id, nom, a, h, z, hors: pasPourMoi(a, h) })).sort((x, y) => String(x.nom).localeCompare(String(y.nom)));
      const miens = ff.filter((f) => !f.hors), autres = ff.filter((f) => f.hors), nmax = opts.court ? 3 : 8;
      const un = (f) => { const z = zoneFr(AP, f.z), c = monCamp === "tous" ? campServi(f.a, f.h) : ""; return `${lienExt(WHN(f.id), f.nom || "formateur " + f.id)}${z || c ? ` (${esc([z, c].filter(Boolean).join(", "))})` : ""}`; };
      if (miens.length) out.push({ t: "Formateur", h: `${niveau > 1 ? `à partir ${esc(deMetier(m))} ${fmtN(niveau)}, ` : ""}chez ${miens.slice(0, nmax).map(un).join(", ")}${miens.length > nmax ? ` et ${fmtN(miens.length - nmax)} autre${miens.length - nmax > 1 ? "s" : ""}` : ""}.` });
      if (autres.length) out.push({ t: miens.length ? "" : "Formateur", hors: true, h: `${fmtN(autres.length)} formateur${autres.length > 1 ? "s ne servent" : " ne sert"} que ${CAMPS_DE[monCamp === "horde" ? "alliance" : "horde"]}${miens.length ? "" : ` : ${autres.slice(0, nmax).map(un).join(", ")}`}.` });
    }
    const parObjet = (pid, nomP, niv) => {
      const p = (AP.plans || {})[pid], nomPlan = (p && p.nom) || nomP || "objet " + pid, mot = motPlan(metier, nomPlan), op = D.parId.get(Number(pid));
      out.push({ t: mot, h: `${op ? `<a href="#/objet/${op.id}">${esc(nomPlan)}</a>` : lienExt(WH(pid), nomPlan)}${niv > 1 ? `, à apprendre à partir ${esc(deMetier(m))} ${fmtN(niv)}` : ""}${p && p.lien === "bop" ? `. <b>Lié quand ramassé</b> : il ne s'achète pas à un joueur` : ""}.` });
      const cc = cheminsPlan(pid, AP, { ici: true, max: opts.court ? 2 : 6 });
      if (cc.length) out.push(...cc);
      else out.push({ t: "Source", h: p ? "aucune source connue de Wowhead Forever : ni marchand, ni quête, ni butin, et jamais vu à cet hôtel des ventes." : "fiche de l'objet absente du relevé, et jamais vu à cet hôtel des ventes." });
    };
    if (mode === "objet") for (const [pid, nomP] of so.objets || []) parObjet(pid, nomP, niveau);
    if (plan != null) parObjet(plan, null, pn);
    return out;
  }
  const blocApprendre = (lignes, titre = "Comment apprendre cette recette", cleAide = "apprendre") => !lignes.length ? "" :
    `<section class="appr" aria-label="${esc(titre)}"><h2>${esc(titre)} ${aide(cleAide)}</h2><ul class="appr-l">${lignes.map((x, i) =>
      `<li${x.tete ? ' class="appr-tete"' : x.hors ? ' class="hors" title="Hors de portée de votre camp (réglage « Mon camp » de l\'artisanat)"' : ""}><span class="appr-t">${i && !x.tete && lignes[i - 1].t === x.t ? "" : esc(x.t)}</span><span>${x.h}</span></li>`).join("")}</ul></section>`;
  const p2 = (n) => String(n).padStart(2, "0");
  /* Prix en texte simple (attributs, étiquettes) : 8 po 55 pa 99 pc. */
  function prixTexte(c) {
    if (!nb(c)) return VIDE;
    c = Math.round(c); const neg = c < 0 ? "-" : ""; c = Math.abs(c);
    const po = Math.floor(c / 10000), pa = Math.floor((c % 10000) / 100), pc = c % 100;
    if (po) return `${neg}${po.toLocaleString("fr-FR")} po ${p2(pa)} pa${po < 100 ? " " + p2(pc) + " pc" : ""}`;
    return pa ? `${neg}${pa} pa ${p2(pc)} pc` : `${neg}${pc} pc`;
  }
  /* Prix en pièces : nombre puis pastille or, argent, cuivre. Au-delà de 100 pièces d'or, le cuivre n'est plus affiché. */
  function pieces(c) {
    if (!nb(c)) return ND;
    c = Math.round(c); const neg = c < 0; c = Math.abs(c);
    const po = Math.floor(c / 10000), pa = Math.floor((c % 10000) / 100), pc = c % 100, m = [];
    if (po) { m.push([po.toLocaleString("fr-FR"), "or"], [p2(pa), "ar"]); if (po < 100) m.push([p2(pc), "cu"]); }
    else if (pa) m.push([String(pa), "ar"], [p2(pc), "cu"]);
    else m.push([String(pc), "cu"]);
    const t = prixTexte(neg ? -c : c);
    return `<span class="prix${neg ? " moins-t" : ""}" role="img" aria-label="${t}" title="${t}">${neg ? "-" : ""}${m.map(([n, k]) => `<span>${n}</span><i class="p ${k}"></i>`).join("")}</span>`;
  }
  /* Gros montants, arrondis : pièces d'or dès 1 po, sinon argent ou cuivre. */
  function montant(c) {
    if (!nb(c)) return ND;
    const a = Math.abs(c);
    const [txt, k, nom] = a >= 1000000 ? [fmtN(c / 10000), "or", "pièces d'or"] : a >= 10000 ? [fmtN(c / 10000, 1), "or", "pièces d'or"] : a >= 100 ? [fmtN(c / 100), "ar", "pièces d'argent"] : [fmtN(c), "cu", "pièces de cuivre"];
    return `<span class="prix${c < 0 ? " moins-t" : ""}" role="img" aria-label="${txt} ${nom}" title="${prixTexte(c)}"><span>${txt}</span><i class="p ${k}"></i></span>`;
  }
  /* Variation : couleur et signe, toujours les deux. lib : libellé court de la fenêtre (« 14 j »). */
  function variation(t, lib, titre) {
    if (!nb(t)) return `<span class="var nd">${VIDE}</span>`;
    const p = Math.round(100 * t), suf = lib ? `<small>${esc(lib)}</small>` : "", ti = titre ? ` title="${esc(titre)}"` : "";
    if (p === 0) return `<span class="var"${ti}>0${NBSP}%${suf}</span>`;
    return p > 0 ? `<span class="var plus"${ti}><i aria-hidden="true">▲</i>+${fmtN(p)}${NBSP}%${suf}</span>` : `<span class="var moins"${ti}><i aria-hidden="true">▼</i>-${fmtN(Math.abs(p))}${NBSP}%${suf}</span>`;
  }
  const pctTxt = (t) => nb(t) ? Math.round(100 * t) + NBSP + "%" : VIDE;
  /* Jauge d'écoulement : part vendue (claire) sur ce qui a été déposé (sombre). */
  function jauge(t) {
    if (!nb(t)) return `<div class="ecoul" title="non calculé sous 20 unités déposées"><b class="nd">${VIDE}</b></div>`;
    const p = Math.round(100 * t);
    return `<div class="ecoul" title="${p} unités vendues pour 100 déposées"><span class="jauge"><i style="width:${Math.max(0, Math.min(100, p))}%"></i></span><b>${p}${NBSP}%</b></div>`;
  }
  const ETOILE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.6l2.3 4.7 5.2.8-3.8 3.6.9 5.2L10 14.4l-4.6 2.5.9-5.2L2.5 8.1l5.2-.8z"/></svg>';
  /* Mini-courbe : une ligne, point final marqué. Les valeurs nulles sont sautées. */
  function mini(vals, o = {}) {
    const w = o.w || 108, h = o.h || 30, pad = 4, couleur = o.couleur || C.med;
    const pts = vals.map((v, i) => [i, v]).filter(([, v]) => v != null);
    if (pts.length < 2) return "";
    const lo = Math.min(...pts.map((q) => q[1])), hi = Math.max(...pts.map((q) => q[1]));
    const x = (i) => pad + i * (w - 2 * pad) / (vals.length - 1);
    const y = (v) => hi === lo ? h / 2 : pad + (hi - v) * (h - 2 * pad) / (hi - lo);
    const d = pts.map(([i, v], k) => (k ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    const [li, lv] = pts[pts.length - 1], lab = esc(o.label || "Évolution");
    return `<svg class="mini" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${lab}"><title>${lab}</title><path d="${d}" fill="none" stroke="${couleur}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="2.6" fill="${couleur}" stroke="var(--bg-1)" stroke-width="1.5"/></svg>`;
  }

  // ------------------------------------------------------- textes de méthode
  /* Chaque texte sert deux fois : dans la bulle « ? » de l'écran concerné et dans la page #/methode. */
  const AIDES = {
    ventes: ["Ventes estimées", "Une vente est estimée quand une annonce disparaît entre deux photos horaires de l'hôtel des ventes, hors retraits probables et annonces expirées. L'API ne dit pas ce qui se passe entre deux photos : ce sont des estimations, pas un relevé des transactions."],
    mediane: ["Prix médian vendu", "La moitié des unités vendues sont parties à ce prix ou moins. Dans une liste, c'est la médiane des ventes estimées de la période choisie ; sur une fiche, celle des 7 derniers jours."],
    plancher: ["Plancher", "L'annonce la moins chère, en médiane sur les relevés du jour."],
    courbe: ["Prix sur 7 jours", "La mini-courbe trace la médiane vendue de chaque jour. Le pourcentage compare la dernière valeur connue à la première valeur connue de cette même fenêtre : il se lit avec la courbe, quelle que soit la période choisie."],
    tendance: ["Tendance", "Médiane vendue du dernier jour comparée à la médiane vendue des 7 derniers jours."],
    ecoulement: ["Écoulement", "Unités vendues pour 100 déposées sur la période. La barre claire est la part vendue, la barre sombre ce qui a été déposé. Au-dessus de 100 %, le stock se vide : la demande est plus forte que l'offre. Non calculé sous 20 unités déposées."],
    stock: ["Heures de stock", "Ce qui est en vente en fin de journée, rapporté aux ventes par heure. Sous 3 heures, le stock part avant le soir : c'est le moment de poster."],
    soutenu: ["Ventes soutenues", "Ne garde que les objets qui se vendent assez pour qu'une variation ait un sens : au moins 150 unités et 300 pièces d'or par jour sur 7 jours, munitions exclues. C'est le filtre des blocs de l'accueil."],
    or: ["Or échangé", "Somme des ventes estimées d'une journée, de minuit à minuit, heure de Paris. Le grand chiffre est la journée en cours : elle n'est pas finie et grossit à chaque relevé, une fois par heure. Elle est comparée à la veille arrêtée à la même heure, et seulement si les deux journées ont le même nombre de relevés. Le rappel dessous donne la dernière journée complète, comparée à la journée complète qui la précède : les journées de collecte incomplète sont écartées de cette comparaison."],
    h24: ["Dernières 24 heures", "Or et unités des ventes estimées sur les 24 heures qui précèdent la dernière photo."],
    annonces: ["Annonces en vente", "Annonces et objets différents relevés à la dernière photo de l'hôtel des ventes."],
    suivis: ["Objets suivis", "Objets vus au moins une fois à l'hôtel des ventes depuis le début de la collecte."],
    monte: ["Ce qui monte, ce qui baisse", "Variation du prix médian vendu entre le début et la fin de la mini-courbe. Seuls les objets aux ventes soutenues sont classés : 150 unités et 300 pièces d'or par jour au moins, munitions exclues. Une baisse marquée sur un objet qui se vend beaucoup signale souvent une offre qui arrive en masse."],
    monteJ: ["Ce qui monte, ce qui baisse", "Médiane vendue du dernier jour comparée à la médiane vendue des 7 derniers jours. Seuls les objets aux ventes soutenues sont classés : 150 unités et 300 pièces d'or par jour au moins, munitions exclues."],
    manque: ["Ce qui manque", "Les objets aux ventes soutenues qui ont le moins d'heures de stock, sous 6 heures. Un objet affiché à 0 h alors qu'il lui reste du stock en vente est ignoré : c'est un artefact de mesure, pas une pénurie."],
    mes: ["Mes objets", "Les objets que vous épinglez avec l'étoile, depuis une liste ou une fiche. Ils sont enregistrés dans ce navigateur seulement : rien n'est envoyé, et un autre appareil aura sa propre liste."],
    metiers: ["Mes métiers", "Vos métiers préremplissent le filtre de métier d'Artisanat et de Farm. Le choix reste dans ce navigateur : rien n'est envoyé."],
    verdict: ["Se vend-il ?", "Avec un conseil de la chaîne de collecte, le verdict suit le délai de vente attendu au prix conseillé : « Oui, vite » jusqu'à 4 heures, « Oui, lentement » jusqu'à 24 heures, « Mal » au-delà, ou quand rien ne s'est vendu à ce prix ou plus cher en 7 jours. L'écoulement des 7 jours le borne : sous 40 % d'écoulement, au mieux « Oui, lentement » ; sous 15 %, « Mal ». Sans conseil, le verdict se rabat sur les 7 derniers jours : « Oui, vite » à partir de 24 ventes par jour avec 40 % d'écoulement, « Mal » sous 15 % d'écoulement, « Oui, lentement » entre les deux. Sous une vente par jour, toujours « Mal »."],
    conseil: ["Prix conseillé", "Prix, durée d'annonce et délai calculés par la chaîne de collecte d'après les annonces en vente et les ventes des 7 jours. Le délai compte les unités en vente à votre niveau de prix (à 2 % près, au même prix ou un peu moins cher), plus la vôtre, et les divise par le rythme des seules ventes des 7 jours faites à ce prix ou plus cher (« Ventes à ce prix ou plus »). Être le moins cher ne suffit donc pas : encore faut-il que des acheteurs paient ce prix. La règle appliquée est rappelée sous le prix. Quand les annonces sont plus chères que les ventes (premier quartile des annonces au-dessus de 1,1 fois la médiane vendue), le prix conseillé est ramené à 1,1 fois cette médiane : sur trois jours d'annonces mesurés, une annonce posée au premier quartile se vend une fois sur deux tant qu'il reste à ce niveau, et moins d'une fois sur cinq quand il dépasse 1,5 fois la médiane vendue."],
    pv: ["Prix et volumes par jour", "Médiane vendue : prix médian des ventes estimées du jour. Plancher : l'annonce la moins chère, en médiane sur les relevés du jour. Dessous, sur le même axe de temps, ce qui a été déposé et ce qui s'est vendu. Les jours grisés n'ont pas tous leurs relevés. Au clavier : flèches gauche et droite pour lire jour par jour, Échap pour quitter."],
    fourchette: ["Ventes en fourchette", "Pour certains objets et certains jours, les ventes sont estimées par la priorité de prix et rangées en trois degrés de certitude : sûres, probables, possibles. La fourchette va des ventes sûres au total des trois ; la valeur centrale additionne les sûres et les probables. Les unités exclues de cette estimation sont affichées comme sorties sans vente."],
    profondeur: ["Profondeur du marché", "Quantité en vente à chaque niveau de prix, au dernier relevé, du moins cher au plus cher. Votre annonce passe après tout ce qui est moins cher : le trait doré montre où le prix conseillé vous place dans la file."],
    ventesPrix: ["Ventes et annonces par prix", "Les mêmes tranches de prix pour deux choses : les unités vendues sur les 7 derniers jours (ventes sûres, au prix de l'annonce partie) et les unités en vente au dernier relevé. Là où les ventes se concentrent, l'objet trouve preneur ; une tranche pleine d'annonces sans vente est un prix affiché, pas un prix de marché. Le liseré doré marque la tranche du prix conseillé, le liseré gris celle de la médiane vendue des 7 jours."],
    heures: ["Ventes par heure du jour", "Unités vendues par heure du jour, heure de Paris, cumulées sur 7 jours. Poster juste avant les heures pleines réduit le délai de vente."],
    paliers: ["À quel prix ça part", "Ce que deviennent les annonces selon le prix auquel elles ont été posées : vendues, dont vendues dans l'heure, perdues (sorties sans vente) ou encore en vente."],
    recettes: ["Recettes liées", "Les recettes qui fabriquent cet objet et celles qui le consomment, avec la médiane vendue sur 7 jours de ce qu'elles produisent et le nombre vendu par jour. Recettes et sources : SkillUp Forever."],
    vueGlobale: ["Vue d'ensemble de l'artisanat", "Toutes les recettes qui donnent un objet, métier par métier, selon ce qu'elles valent aujourd'hui. Rentable : le produit vendu, commission déduite, rapporte plus que ses composants. À perte : il rapporte moins. Non chiffrable : on ne peut pas le dire, parce que le produit n'a jamais été vu à l'hôtel des ventes, qu'il ne s'est pas vendu en 7 jours, ou qu'un composant n'a pas de prix ; la raison est sur la ligne. Les barres sont à la même échelle d'un métier à l'autre. Un clic sur un métier ne garde que ses recettes, un second clic le retire ; on peut en choisir plusieurs, puis mémoriser ce choix comme « mes métiers ». Les comptes suivent le niveau maximal saisi et le prix de revente choisi. Les enchantements appliqués, qui ne donnent pas d'objet à vendre, n'y sont pas."],
    lecture: ["Prix de revente", "Médiane vendue 7 j : le prix auquel le produit s'est réellement vendu sur les 7 derniers jours, la lecture de référence. Plancher du moment : l'annonce la moins chère au dernier relevé, c'est-à-dire le prix à battre si vous postez maintenant ; il peut tenir à une seule annonce bradée. À l'inverse, un plancher très au-dessus des ventes récentes ne dit pas que le produit se vendra à ce prix : la revente retenue est plafonnée à 1,5 fois la médiane vendue des 7 jours, et la ligne porte l'étiquette « plafonné ». L'étiquette « fragile » signale une recette dont le verdict change d'une lecture à l'autre : rentable sur 7 jours et à perte en ce moment, ou l'inverse. Au plancher du moment, une recette dont le produit n'a aucune annonce n'est pas chiffrable."],
    coutRevente: ["Coût et revente", "Coût : ce que coûtent les composants d'une fabrication, au premier quartile des annonces du jour (ou au plancher), ou chez le marchand s'il vend moins cher. Revente : ce que rapporte le produit vendu à l'hôtel des ventes, à la médiane vendue des 7 derniers jours, commission de l'hôtel déduite. Les deux barres sont à la même échelle : quand la barre de revente dépasse celle du coût, la fabrication rapporte ; quand elle est plus courte, elle passe au rouge et la fabrication coûte plus qu'elle ne rapporte. Le pourcentage sous la marge est la rentabilité : la marge nette rapportée au coût. Une forte rentabilité sur un produit qui se vend peu rapporte moins qu'une petite sur un produit très demandé : la colonne du gain par jour tient compte des deux."],
    artisanat: ["Rentabilité d'une recette", "Produit compté à la médiane vendue des 7 derniers jours, net de la commission de l'hôtel des ventes. Composants au premier quartile des annonces du jour (ou au plancher), ou chez le marchand s'il vend moins cher (à son prix de base, ou à votre prix une fois « Ma remise chez les marchands » réglée). Le gain par jour est celui d'un seul vendeur, qui écoule un nombre plafonné de pièces ou une part du marché s'il est plus grand ; le marché, c'est la marge fois toutes les ventes. Les recettes étiquetées « recharge » ne se fabriquent qu'une fois par temps de recharge et par personnage (transmutations, Étoffe lunaire) : leur gain par jour compte ce que la recharge permet, pas ce que le marché absorberait. Chaque recette est comptée seule : si plusieurs transmutations partagent leur recharge, leurs gains ne s'additionnent pas. Durées relevées sur Wowhead Forever ; quand une durée reste à relever, le gain par jour n'est pas chiffré."],
    apprendre: ["Comment apprendre une recette", "Du chemin le plus simple au plus long, et seulement ceux qui existent. « Connue d'office » : la recette vient avec le métier. « Formateur » : son prix et le niveau de métier exigé quand ils sont connus. Sinon la recette s'apprend avec un objet (plan, patron, formule, schéma, parchemin de recette) : « Hôtel des ventes » dit s'il est en vente ici au dernier relevé et à partir de quel prix ; « Marchand » donne le nom, la zone, le camp servi, en rouge la réputation exigée pour l'acheter, le prix, et le stock quand il est limité ; « Quête » et « Butin » renvoient à Wowhead. Une ligne grisée est hors de portée de votre camp (réglage « Mon camp » de l'artisanat). Formateurs, marchands, prix et réputations viennent du relevé de Wowhead Forever du 23 novembre 2026 : un prix de marchand peut varier avec la réputation, et un stock limité se renouvelle. Un plan ne se paie pas toujours en pièces : le relevé donne alors la monnaie ou l'objet exigé et sa quantité. Pour la Faveur de marchand, gagnée en remettant des caisses détournées remplies, « soit environ » donne l'équivalent en or au cours des caisses du dernier relevé : la remise la moins chère par point, caisse au plancher plus son lot, pour la Faveur de base de la caisse (le survol dit laquelle) ; un bonus de performance peut la doubler, ce qui diviserait ce coût. Pour un objet exigé qui se vend ici, le plancher du moment : c'est alors un plan achetable en or. Les autres monnaies n'ont pas de cours connu ici.", ""],
    remise: ["Remise chez les marchands", "Un marchand vend moins cher à qui a de la réputation auprès de sa faction : 5 % au rang Amical, 10 % Honoré, 15 % Révéré, 20 % Exalté dans le barème de Classic (à vérifier en jeu : le prix que le marchand vous affiche fait foi). Sans réglage, le site compte le prix de base du marchand. Avec votre remise, un composant vendu par un marchand est compté au moins cher de son prix remisé et de l'hôtel des ventes ; le coût, la marge, le gain et l'état de chaque recette sont recalculés dans la page, et l'origine de chaque prix est écrite à côté du composant. Limites : un seul taux pour tous les marchands, alors que la remise dépend de la faction de chacun ; la page de la Faveur de marchand garde les chiffres sans remise. Le réglage reste dans ce navigateur : rien n'est envoyé."],
    camp: ["Camp d'une recette", "Certaines recettes ne s'apprennent qu'avec un plan, un patron, une formule ou un schéma qu'un seul camp peut obtenir : récompense d'une quête de ce camp, ou marchand qui ne sert que lui, sans aucun butin. Leur produit peut très bien se vendre à l'hôtel des ventes de l'autre camp : c'est le piège. L'étiquette « plan Alliance seulement » ou « plan Horde seulement » le signale, sur la recette, sur l'objet fabriqué et sur le plan lui-même, avec la source. Un plan lié quand ramassé est introuvable pour l'autre camp ; un plan non lié s'achète à un joueur, et l'avis dit s'il est en vente à cet hôtel des ventes et à quel prix. « Mon camp » grise dans l'artisanat les recettes hors de portée, et peut les masquer ; le choix reste dans ce navigateur. « Source inconnue » marque une recette dont Wowhead Forever ne connaît aucune source : ce n'est pas un piège établi. Limites : un marchand à stock limité compte comme accessible, un butin en zone ennemie aussi. Le relevé, fait sur Wowhead Forever, n'est pas encore complet : une recette sans étiquette peut ne pas avoir été relevée."],
    faveur: ["Faveur de marchand", "La Faveur de marchand se gagne en remettant des caisses détournées remplies. Le cours du point est le coût de la remise la moins chère par point au dernier relevé : la caisse au plancher plus son lot le moins cher, divisés par la Faveur de base de la caisse (valeurs de l'addon WaylaidCost, hors bonus de performance, qui peut la doubler : à vérifier en jeu). L'équivalent en or d'un plan est son coût en Faveur multiplié par ce cours : il change à chaque relevé. Marge, ventes et gain par jour sont ceux de l'artisanat pour la recette que le plan enseigne, sans second calcul. « Plan remboursé en N jours » divise le coût du plan en or par le gain quotidien d'un vendeur. « Jamais vu » : le produit n'a jamais été en vente à cet hôtel des ventes depuis le début des relevés, ce qui ne dit pas qu'il ne se vendrait pas. Ces plans sont liés quand ramassés, sauf ceux marqués « non lié », qui s'achètent et se revendent à un joueur : pour eux la ligne dit ce que le plan lui-même vaut ici, et l'étiquette « revente > coût » signale un plan qui se revend plus cher, commission déduite, que son coût en Faveur converti. Marchands, coûts et listes viennent du relevé des pages des marchands sur Wowhead Forever ; les autres monnaies n'ont pas de cours connu ici, sauf un objet exigé qui se vend à cet hôtel des ventes."],
    marge: ["Marge nette par jour", "Médiane vendue du produit, nette de la commission, moins le coût des composants au prix du jour : premier quartile des annonces dès 4 annonces, sinon plancher, ou prix du marchand quand il vend le composant."],
    farm: ["Ce qui vaut la peine d'être farmé", "Ce que vous touchez pour chaque objet récolté, dépecé, pêché ou ramassé, net de la commission de l'hôtel des ventes, sur les 7 derniers jours. Seuls figurent les objets qui se vendent vraiment. La chaîne ne connaît ni les zones ni les taux de butin : le lien Wowhead dit où et combien."],
    fraicheur: ["Fraîcheur des données", "La pastille de l'en-tête donne la date de la dernière photo de l'hôtel des ventes intégrée et son âge. Au-delà de 2 heures, elle passe à l'orange : la collecte est en retard."],
  };
  const FARM_BASE = AIDES.farm[1];
  const aide = (cle, label) => `<button type="button" class="aide" data-aide="${cle}" aria-expanded="false" aria-label="${esc(label || "Comment c'est calculé : " + (AIDES[cle] || [""])[0])}">?</button>`;

  // ------------------------------------------------------- stockage du navigateur
  /* Épingles (hv-epingles) et métiers (hv-metiers) : rien ne sort du navigateur. */
  const boite = {
    lire(cle) { try { const v = JSON.parse(localStorage.getItem(cle)); return Array.isArray(v) ? v : []; } catch (e) { return []; } },
    ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  };
  let epingles = boite.lire("hv-epingles").map(Number).filter(Number.isFinite);
  let mesMetiers = boite.lire("hv-metiers").map(String);
  /* Camp du lecteur (hv-camp) : « horde » par défaut, c'est l'hôtel des ventes de la Horde ; « alliance » ; « tous » pour ne
     rien griser. Second élément : 1 pour masquer, dans l'artisanat, les recettes dont le plan est réservé à l'autre camp. */
  const campLu = boite.lire("hv-camp");
  let monCamp = ["horde", "alliance", "tous"].includes(campLu[0]) ? campLu[0] : "horde", masquerAutreCamp = campLu[1] === 1;
  const noterCamp = () => boite.ecrire("hv-camp", [monCamp, masquerAutreCamp ? 1 : 0]);
  /* Remise chez les marchands (hv-remise), en pour cent du prix de base : 0 tant que le lecteur n'a rien réglé. */
  const REMISES = [0, 5, 10, 15, 20];
  const remiseLue = Number(boite.lire("hv-remise")[0]);
  let maRemise = REMISES.includes(remiseLue) ? remiseLue : 0;
  function basculerEpingle(id) {
    epingles = epingles.includes(id) ? epingles.filter((i) => i !== id) : [...epingles, id];
    boite.ecrire("hv-epingles", epingles);
    if (D.rafraichir) D.rafraichir();
    majEpingles();
  }
  function majEpingles() {
    $$(".epingle[data-id]").forEach((b) => {
      const on = epingles.includes(Number(b.dataset.id));
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = on ? "Retirer de mes objets" : "Épingler dans mes objets";
      const t = b.querySelector(".txt"); if (t) t.textContent = on ? "Épinglé" : "Épingler";
    });
  }
  const boutonEpingle = (o, grand) => `<button type="button" class="epingle${grand ? " grand" : ""}" data-id="${o.id}" aria-pressed="false" aria-label="Épingler ${esc(o.nom)}">${ETOILE}${grand ? '<span class="txt">Épingler</span>' : ""}</button>`;

  // ------------------------------------------------------------------ données
  async function charger(url) {
    if (!D.cache.has(url)) {
      D.cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} : ${r.status}`); return r.json(); })
        .catch((e) => { D.cache.delete(url); throw e; }));
    }
    return D.cache.get(url);
  }
  const chargerFacultatif = (url) => charger(url).catch(() => null);
  /* Chaque fichier porte ses colonnes : les lignes sont lues par nom de colonne, pas par position. */
  const tab = (colonnes, lignes) => { const n = (colonnes || []).length; return (lignes || []).map((l) => { const r = {}; for (let i = 0; i < n; i++) r[colonnes[i]] = l[i]; return r; }); };
  /* Remise chez les marchands (26/11/2026, remarque de Saby : son charbon lui coûte 4 pa 50 chez le marchand, le site le
     comptait 4 pa 84 à l'hôtel des ventes faute de connaître sa remise de réputation). data/artisanat.json porte, pour
     chaque composant vendu par un marchand, [prix de base, prix à l'hôtel ou null] (clé marchands). lignesRemise refait
     pour un taux le calcul d'exporter_site.py, mêmes formules et mêmes arrondis : composant au moins cher du prix remisé
     (arrondi au cuivre inférieur) et de l'hôtel, puis coût, marge, gain d'un vendeur, taille du marché, état, marge au
     plancher du moment et étiquette « fragile ». Une ligne que la remise ne touche pas est rendue telle quelle ; `tout`
     les recalcule toutes (contrôle de fidélité à l'export, au taux 0). */
  function lignesRemise(art, taux, tout) {
    const C = {}; (art.colonnes || []).forEach((c, i) => { C[c] = i; });
    const M = art.marchands || {}, com = art.commission || 0, plafond = art.plafond_jour ?? 20, part = art.part_marche ?? 0.1;
    const ent = (x) => Math.trunc(x) + 0;
    return (art.lignes || []).map((l) => {
      let touche = !!tout, complet = true, cout = 0;
      const comps = (l[C.composants] || []).map((c) => {
        if (c[2] == null) { complet = false; return c; }
        const m = M[c[0]];
        let x = c;
        if (m) {
          const rem = Math.floor(m[0] * (100 - taux) / 100), hv = m[1] != null && m[1] < rem;
          const pu = hv ? m[1] : rem, src = hv ? "HV" : "marchand";
          if (pu !== c[2] || src !== c[3]) { x = [c[0], c[1], pu, src]; touche = true; }
        }
        cout += x[2] * x[1];
        return x;
      });
      if (!touche) return l;
      const n = l.slice();
      n[C.composants] = comps;
      if (!complet) return n;
      n[C.cout] = ent(cout);
      if (l[C.etat] === "non_chiffrable") return n;
      const qp = l[C.qp] || 1, vj = l[C.vendus_j] || 0, rh = l[C.recharge_h], revI = l[C.revente_instant];
      const margeF = l[C.med_vendu_7j] * qp * (1 - com) - cout, marge = ent(margeF);
      let ecoul = Math.min(vj, Math.max(plafond, part * vj));
      if (rh != null) ecoul = rh ? Math.min(ecoul, 24 / rh * qp) : 0;
      const margeI = revI ? ent(revI * qp * (1 - com) - cout) : null;
      n[C.marge] = marge; n[C.gain_j] = ent(margeF * ecoul); n[C.marche_j] = ent(margeF * vj);
      n[C.etat] = marge > 0 ? "rentable" : "perte";
      n[C.marge_instant] = margeI; n[C.fragile] = margeI != null && (marge > 0) !== (margeI > 0);
      return n;
    });
  }
  /* Le document de l'artisanat au taux du lecteur : l'original tant que la remise est à 0, sinon une copie dont les
     lignes sont recalculées (gardée par document et par taux), marquée de sa remise. */
  const artRemise = new WeakMap();
  function avecRemise(art) {
    if (!art || !maRemise || !art.marchands || !Array.isArray(art.lignes)) return art;
    let parTaux = artRemise.get(art);
    if (!parTaux) { parTaux = new Map(); artRemise.set(art, parTaux); }
    if (!parTaux.has(maRemise)) parTaux.set(maRemise, { ...art, lignes: lignesRemise(art, maRemise), remise: maRemise });
    return parTaux.get(maRemise);
  }
  /* D'où vient le prix d'un composant, et ce que vaut l'autre source quand un marchand le vend aussi. */
  const prixRemise = (art, id) => { const m = (art.marchands || {})[id]; return m ? Math.floor(m[0] * (100 - (art.remise || 0)) / 100) : null; };
  const aMarchand = (art, comps) => (comps || []).some((x) => (art.marchands || {})[x[0]]);
  function origineComp(art, id, pu, src) {
    if (pu == null) return "pas de prix";
    const m = (art.marchands || {})[id];
    if (src === "marchand") return `${prixTexte(pu)} au marchand${m && art.remise ? `, remise de ${art.remise}${NBSP}% sur ${prixTexte(m[0])}` : ""}`;
    return `${prixTexte(pu)} à l'hôtel des ventes${m ? ` ; ${prixTexte(prixRemise(art, id))} au marchand${art.remise ? `, remise de ${art.remise}${NBSP}% comprise` : ", sans remise"}` : ""}`;
  }
  function sourceComp(art, id, src) {
    const m = (art.marchands || {})[id];
    if (src === "marchand") return `marchand${m && art.remise ? ` <span class="nd">(remise de ${art.remise}${NBSP}% sur ${prixTexte(m[0])})</span>` : ""}`;
    return `hôtel des ventes${m ? ` <span class="nd">(marchand : ${prixTexte(prixRemise(art, id))}${art.remise ? `, remise de ${art.remise}${NBSP}% comprise` : ", sans remise"})</span>` : ""}`;
  }
  const choixRemise = () => `<span class="puces serre remise" role="group" aria-label="Votre remise chez les marchands">${REMISES.map((k) => `<button type="button" class="puce" data-remise="${k}" aria-pressed="${k === maRemise}">${k}${NBSP}%</button>`).join("")}</span>`;
  function objetDe(r) {
    return { id: r.id, nom: r.nom || r.nom_en || `Objet ${r.id}`, en: r.nom_en && r.nom_en !== r.nom ? r.nom_en : "", classe: r.classe || "", sc: r.sous_classe || "", qual: r.qualite || null,
      niv: r.niveau ?? null, emp: r.empilable, src: r.sources || [], vj: r.vendus_j ?? 0, valj: r.valeur_j ?? 0, mv7: r.med_vendu_7j ?? null, mv1: r.med_vendu_dernier ?? null,
      pl: r.plancher ?? null, st: r.stock ?? null, tend: r.tendance ?? null, vtot: r.vendus_total ?? 0, valtot: r.valeur_total ?? 0, premier: r.premier_jour, dernier: r.dernier_jour,
      dep: r.deposes_j ?? null, taux: r.taux ?? null, hs: r.heures_stock ?? null, k: norm(r.nom) + " | " + norm(r.nom_en) };
  }
  const metierFr = (m) => (D.meta && D.meta.metiers && D.meta.metiers[String(m)] || {}).fr || String(m);
  const classeTexte = (o) => [o.classe, o.sc && o.sc !== o.classe ? o.sc : null].filter(Boolean).join(" · ");
  const soutenu = (o) => o.classe !== "Projectile" && (o.vj || 0) >= SEUIL.vj && (o.valj || 0) >= SEUIL.valj;
  /* Heures de stock utiles : un 0 h affiché alors qu'il reste du stock est un artefact, pas une pénurie. */
  const hsUtile = (o) => (!nb(o.hs) || (o.hs < 0.05 && o.st > 0)) ? null : o.hs;
  function sourcesTexte(src, noeud) {
    const out = [];
    for (const s of src || []) {
      const [t, m] = String(s).split(":");
      if (t === "recolte") out.push((m === "356" ? "pêche" : "récolte : " + metierFr(m)) + (noeud ? ` (niveau ${noeud})` : ""));
      else if (t === "fabrique") out.push("fabriqué : " + metierFr(m));
      else if (t === "butin") out.push("butin de créatures");
      else if (t === "marchand") out.push(m === "limite" ? "marchand, stock limité" : "marchand");
      else if (t === "quete") out.push("objet de quête");
    }
    return out;
  }
  /* Mini-courbes : médiane vendue par jour (data/courbes.json). La variation se lit sur la même fenêtre que la courbe. */
  /* Fenêtre des mini-courbes et de leur variation : les sept derniers jours du fichier (qui en porte quatorze). Sur un serveur
     jeune, quatorze jours remontent aux prix du lancement et donnent des variations de +1 000 % sans intérêt. */
  const FEN_COURBE = 7;
  const nCourbe = () => Math.min(FEN_COURBE, D.courbes.jours.length);
  const courbe = (id) => { const l = D.courbes && D.courbes.lignes[id]; return Array.isArray(l) ? l.slice(-FEN_COURBE) : null; };
  const libCourbe = () => `${nCourbe()}${NBSP}j`;
  function var14(id) {
    if (!D.courbes) return null;
    if (!D.v14.has(id)) {
      const v = (courbe(id) || []).filter((x) => nb(x) && x > 0);
      D.v14.set(id, v.length >= 2 ? v[v.length - 1] / v[0] - 1 : null);
    }
    return D.v14.get(id);
  }
  const dernierCours = (id) => { const v = (courbe(id) || []).filter((x) => nb(x)); return v.length ? v[v.length - 1] : null; };
  /* Variation d'un objet : celle de la courbe quand elle existe, sinon la tendance du dernier jour contre les 7 jours. */
  const variationDe = (o) => D.courbes ? var14(o.id) : o.tend;
  function celluleTendance(o) {
    if (!D.courbes) return `<div class="tend">${variation(o.tend, "jour / 7 j", "Dernier jour contre la médiane des 7 jours")}</div>`;
    const l = courbe(o.id), v = var14(o.id);
    if (!l || v == null) return `<div class="tend">${ND}</div>`;
    return `<div class="tend">${mini(l, { label: `Prix médian vendu de ${o.nom} sur ${nCourbe()} jours` })}${variation(v, libCourbe(), `Dernière valeur contre la première sur ${nCourbe()} jours`)}</div>`;
  }
  /* Change des paramètres de l'adresse courante (lue à l'instant, pour garder un filtre saisi entre-temps). */
  function majHash(changements) {
    const [chemin, qs] = location.hash.slice(1).split("?"), p = new URLSearchParams(qs || "");
    for (const [k, v] of Object.entries(changements)) { if (v === "" || v == null) p.delete(k); else p.set(k, v); }
    location.hash = (chemin || "/accueil") + (p.toString() ? "?" + p.toString() : "");
  }
  /* Met le filtre saisi dans l'adresse sans relancer la vue (l'adresse reste partageable). */
  function noterParam(nom, valeur) {
    const [chemin, qs] = location.hash.slice(1).split("?"), p = new URLSearchParams(qs || "");
    if (valeur) p.set(nom, valeur); else p.delete(nom);
    try { history.replaceState(null, "", "#" + chemin + (p.toString() ? "?" + p.toString() : "")); } catch (e) { /* adresse inchangée */ }
  }
  const titre = (t) => { document.title = (t ? t + " · " : "") + "Hôtel des ventes Forever"; };

  // ------------------------------------------------------------------ graphiques
  function echelle(min, max, n = 4) {
    if (!(max > min)) max = min + (Math.abs(min) || 1);
    const brut = (max - min) / n, p = Math.pow(10, Math.floor(Math.log10(brut))), r = brut / p;
    const pas = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
    const lo = Math.floor(min / pas) * pas, hi = Math.ceil(max / pas) * pas, ticks = [];
    for (let v = lo; v <= hi + pas / 2; v += pas) ticks.push(Number(v.toFixed(6)));
    return { min: lo, max: hi, ticks };
  }
  /* Graduations : en entier sous 10 000, compactes au-delà (k, M), un seul style par axe. */
  function fmtAxe(t, e) {
    if (t === 0) return "0";
    const a = Math.max(Math.abs(e.max), Math.abs(e.min));
    if (a >= 1e6) return fmtN(t / 1e6, 2) + NBSP + "M";
    if (a >= 1e4) return fmtN(t / 1e3, 1) + NBSP + "k";
    return fmtN(t, 2);
  }
  const unitePrix = (a) => a >= 10000 ? { div: 10000, nom: "en pièces d'or" } : a >= 100 ? { div: 100, nom: "en pièces d'argent" } : { div: 1, nom: "en pièces de cuivre" };
  const f1 = (v) => v.toFixed(1);
  /* Barre : extrémité de donnée arrondie (4 px), base carrée. */
  function chemBarre(x, w, yt, y0, r = 4) {
    r = Math.max(0, Math.min(r, (y0 - yt) / 2, w / 2));
    return `M${f1(x)},${f1(y0)}V${f1(yt + r)}Q${f1(x)},${f1(yt)} ${f1(x + r)},${f1(yt)}H${f1(x + w - r)}Q${f1(x + w)},${f1(yt)} ${f1(x + w)},${f1(yt + r)}V${f1(y0)}Z`;
  }
  /* Indices à étiqueter sur l'axe du temps, en partant de la fin pour que le dernier jour soit toujours nommé. */
  const etiquettesFin = (n, slot, minPx) => { const pas = Math.max(1, Math.ceil(minPx / slot)); return (i) => (n - 1 - i) % pas === 0; };
  function infobulle(cont) { let t = cont.querySelector(".infobulle"); if (!t) { t = document.createElement("div"); t.className = "infobulle"; t.hidden = true; cont.appendChild(t); } return t; }
  function placer(t, px, W) { const l = t.offsetWidth || 190; t.style.left = Math.max(0, Math.min(W - l, px + 14 + l > W ? px - l - 14 : px + 14)) + "px"; t.style.top = "6px"; }
  /* Ligne d'infobulle : nom de la série (avec sa clé de couleur) puis valeur, déjà en HTML sûr. */
  const rangee = (couleur, nom, valeurHtml) => `<div class="r"><span>${couleur ? `<span class="cle" style="border-color:${couleur}"></span>` : ""}${esc(nom)}</span><b>${valeurHtml}</b></div>`;
  /* Branche pointeur et clavier sur un svg : survol, flèches gauche et droite, Échap. */
  function brancher(el, n, indexDe, montrer, cacher) {
    let actif = -1;
    const va = (i) => { if (i !== actif) { actif = i; montrer(i); } };
    const stop = () => { actif = -1; cacher(); };
    el.addEventListener("pointermove", (ev) => { const i = indexDe(ev); if (i != null) va(i); });
    el.addEventListener("pointerdown", (ev) => { const i = indexDe(ev); if (i != null) va(i); });
    el.addEventListener("pointerleave", stop);
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") { ev.preventDefault(); va(Math.max(0, Math.min(n - 1, (actif < 0 ? n - 1 : actif) + (ev.key === "ArrowRight" ? 1 : -1)))); }
      else if (ev.key === "Escape") stop();
    });
    el.addEventListener("focus", () => { if (actif < 0 && el.matches(":focus-visible")) va(n - 1); });
    el.addEventListener("blur", stop);
  }
  /* Deux panneaux sur un seul axe de temps : des lignes de prix en haut, des barres de volume dessous.
     cfg = { jours, titre, haut: { titre, lignes: [{ couleur, valeurs }] }, bas: { titre, barres: [{ couleur, valeurs }] },
             bande(i) -> jour incomplet, moustache(i) -> [bas, haut] ou null, bulle(i) -> html, vide } */
  function graphiquePanneaux(cont, cfg) {
    const dessiner = () => {
      const W = Math.max(260, Math.floor(cont.clientWidth) || 720), etroit = W < 520, n = cfg.jours.length;
      const vh = cfg.haut.lignes.flatMap((s) => s.valeurs).filter((v) => v != null);
      const mous = cfg.jours.map((_, i) => cfg.moustache ? cfg.moustache(i) : null);
      const maxB = Math.max(0, ...cfg.bas.barres.flatMap((s) => s.valeurs.map((v) => v || 0)), ...mous.filter(Boolean).map((m) => m[1]));
      if (!n || (!vh.length && !(maxB > 0))) { cont.innerHTML = `<p class="rien">${esc(cfg.vide || "Aucune donnée sur cette fenêtre.")}</p>`; return; }
      const u = unitePrix(vh.length ? Math.max(...vh.map(Math.abs)) : 0), pv = vh.map((v) => v / u.div);
      const ep = echelle(pv.length ? Math.min(...pv) : 0, pv.length ? Math.max(...pv) : 1, 4), eb = echelle(0, maxB, 3);
      const libs = ep.ticks.map((t) => fmtAxe(t, ep)).concat(eb.ticks.map((t) => fmtAxe(t, eb)));
      const mg = Math.max(etroit ? 30 : 38, Math.ceil(Math.max(...libs.map((s) => s.length)) * 6.3) + 11), md = etroit ? 6 : 12;
      const hp = etroit ? 176 : 232, hv = etroit ? 96 : 124, t1 = 22, entre = 38, bas = 24;
      const H = t1 + hp + entre + hv + bas, slot = (W - mg - md) / n, xc = (i) => mg + (i + .5) * slot;
      const yp = (c) => t1 + (ep.max - c / u.div) * hp / ((ep.max - ep.min) || 1);
      const tv = t1 + hp + entre, y0 = tv + hv, yv = (v) => y0 - v * hv / (eb.max || 1);
      let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0" aria-label="${esc(cfg.titre)} Flèches gauche et droite pour lire jour par jour, Échap pour quitter.">`;
      for (let i = 0; i < n; i++) if (cfg.bande && cfg.bande(i)) s += `<rect class="bande" x="${f1(mg + i * slot)}" y="${t1}" width="${f1(slot)}" height="${y0 - t1}"/>`;
      s += `<text class="titre-panneau" x="0" y="11">${esc(cfg.haut.titre)}, ${u.nom}</text><text class="titre-panneau" x="0" y="${tv - 11}">${esc(cfg.bas.titre)}</text>`;
      for (const t of ep.ticks) s += `<line class="${t === 0 && ep.min < 0 ? "axe" : "grille"}" x1="${mg}" x2="${W - md}" y1="${f1(yp(t * u.div))}" y2="${f1(yp(t * u.div))}"/><text class="tick" x="${mg - 7}" y="${f1(yp(t * u.div) + 4)}" text-anchor="end">${fmtAxe(t, ep)}</text>`;
      for (const t of eb.ticks) s += `<line class="${t ? "grille" : "axe"}" x1="${mg}" x2="${W - md}" y1="${f1(yv(t))}" y2="${f1(yv(t))}"/><text class="tick" x="${mg - 7}" y="${f1(yv(t) + 4)}" text-anchor="end">${fmtAxe(t, eb)}</text>`;
      const nomme = etiquettesFin(n, slot, 44);
      for (let i = 0; i < n; i++) if (nomme(i)) s += `<text class="tick" x="${f1(xc(i))}" y="${H - 6}" text-anchor="middle">${dateCourt(cfg.jours[i])}</text>`;
      /* volumes : la première série en barre large, les suivantes posées dessus, plus étroites */
      const wd = Math.max(2, Math.min(24, slot * .62));
      cfg.bas.barres.forEach((b, k) => {
        const w = k ? Math.max(1.5, Math.round(wd * .5)) : wd;
        b.valeurs.forEach((v, i) => { if (v > 0) s += `<path data-i="${i}" d="${chemBarre(xc(i) - w / 2, w, yv(v), y0, k ? 3 : 4)}" fill="${b.couleur}"/>`; });
      });
      mous.forEach((m, i) => { if (m && m[1] > m[0]) s += `<line class="moustache" x1="${f1(xc(i))}" x2="${f1(xc(i))}" y1="${f1(yv(m[0]))}" y2="${f1(yv(m[1]))}"/>`; });
      /* prix : lignes de 2 px, marqueurs cerclés de la couleur du fond */
      const rm = n > 45 ? 0 : etroit || n > 21 ? 3.5 : 4;
      for (const l of cfg.haut.lignes) {
        let d = "", ouvert = false;
        l.valeurs.forEach((v, i) => { if (v == null) { ouvert = false; return; } d += (ouvert ? " L" : " M") + f1(xc(i)) + "," + f1(yp(v)); ouvert = true; });
        if (d) s += `<path class="ligne-serie" d="${d.trim()}" stroke="${l.couleur}"/>`;
        l.valeurs.forEach((v, i) => {
          const seul = v != null && l.valeurs[i - 1] == null && l.valeurs[i + 1] == null;
          if (v != null && (rm || seul)) s += `<circle class="marqueur" cx="${f1(xc(i))}" cy="${f1(yp(v))}" r="${rm || 3}" fill="${l.couleur}"/>`;
        });
      }
      s += `<line class="croix" x1="0" x2="0" y1="${t1}" y2="${y0}" visibility="hidden"/><rect class="zone" x="${mg}" y="0" width="${f1(W - mg - md)}" height="${H}"/></svg>`;
      cont.innerHTML = s;
      const el = cont.querySelector("svg"), croix = el.querySelector(".croix"), t = infobulle(cont);
      brancher(el, n, (ev) => { const r = el.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width); return Math.max(0, Math.min(n - 1, Math.floor((px - mg) / slot))); },
        (i) => {
          croix.setAttribute("x1", f1(xc(i))); croix.setAttribute("x2", f1(xc(i))); croix.setAttribute("visibility", "visible");
          t.innerHTML = cfg.bulle(i); t.hidden = false;
          const k = el.getBoundingClientRect().width / W; placer(t, xc(i) * k, W * k);
        },
        () => { croix.setAttribute("visibility", "hidden"); t.hidden = true; });
    };
    dessiner();
    D.graphiques.push(dessiner);
  }
  /* Barres verticales empilées : cfg = { n, H, titre, piles(i) -> [{ v, c }], nomme(i, slot) -> texte ou null,
     etiquette(i) -> texte ou null, bulle(i) -> html, bande(i) }. 2 px de fond entre deux segments d'une pile. */
  function barres(cont, cfg) {
    const dessiner = () => {
      const W = Math.max(240, Math.floor(cont.clientWidth) || 480), H = cfg.H || 168, n = cfg.n;
      const tot = (i) => cfg.piles(i).reduce((a, q) => a + (q.v || 0), 0);
      const e = echelle(0, Math.max(0, ...Array.from({ length: n }, (_, i) => tot(i))), 3);
      const mg = Math.max(30, Math.ceil(Math.max(...e.ticks.map((t) => fmtAxe(t, e).length)) * 6.3) + 11), m = { d: 6, h: 16, b: 22 };
      const y0 = H - m.b, y = (v) => m.h + (e.max - v) * (y0 - m.h) / (e.max || 1), slot = (W - mg - m.d) / n, w = Math.max(2, Math.min(24, slot - (slot > 12 ? 5 : 2)));
      let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0" aria-label="${esc(cfg.titre)} Flèches gauche et droite pour lire barre par barre, Échap pour quitter.">`;
      for (let i = 0; i < n; i++) if (cfg.bande && cfg.bande(i)) s += `<rect class="bande" x="${f1(mg + i * slot)}" y="${m.h}" width="${f1(slot)}" height="${y0 - m.h}"/>`;
      for (const t of e.ticks) s += `<line class="${t ? "grille" : "axe"}" x1="${mg}" x2="${W - m.d}" y1="${f1(y(t))}" y2="${f1(y(t))}"/><text class="tick" x="${mg - 7}" y="${f1(y(t) + 4)}" text-anchor="end">${fmtAxe(t, e)}</text>`;
      for (let i = 0; i < n; i++) {
        const x = mg + i * slot + (slot - w) / 2, ps = cfg.piles(i).filter((q) => q.v > 0);
        let base = 0;
        ps.forEach((q, k) => {
          const yb = y(base) - (k ? 2 : 0), yt = y(base + q.v); base += q.v;
          if (yb - yt < .5) return;
          s += k === ps.length - 1 ? `<path data-i="${i}" d="${chemBarre(x, w, yt, yb)}" fill="${q.c}"/>` : `<rect data-i="${i}" x="${f1(x)}" y="${f1(yt)}" width="${f1(w)}" height="${f1(yb - yt)}" fill="${q.c}"/>`;
        });
        const lib = cfg.nomme(i, slot); if (lib) s += `<text class="tick" x="${f1(mg + i * slot + slot / 2)}" y="${H - 6}" text-anchor="middle">${esc(lib)}</text>`;
        const et = cfg.etiquette && cfg.etiquette(i);
        if (et) { const cx = mg + i * slot + slot / 2, demi = et.length * 3.3; s += `<text class="etiquette" x="${f1(Math.max(mg + demi, Math.min(W - m.d - demi, cx)))}" y="${f1(Math.max(10, y(tot(i)) - 6))}" text-anchor="middle">${esc(et)}</text>`; }
      }
      for (let i = 0; i < n; i++) s += `<rect class="zone" data-z="${i}" x="${f1(mg + i * slot)}" y="0" width="${f1(slot)}" height="${H}"/>`;
      cont.innerHTML = s + "</svg>";
      const el = cont.querySelector("svg"), t = infobulle(cont);
      const marquer = (i, oui) => el.querySelectorAll(`[data-i="${i}"]`).forEach((b) => b.classList.toggle("survol", oui));
      let dernier = -1;
      brancher(el, n, (ev) => { const z = ev.target.closest && ev.target.closest(".zone"); return z ? Number(z.dataset.z) : null; },
        (i) => { if (dernier >= 0) marquer(dernier, false); dernier = i; marquer(i, true); t.innerHTML = cfg.bulle(i); t.hidden = false; const k = el.getBoundingClientRect().width / W; placer(t, (mg + i * slot + slot / 2) * k, W * k); },
        () => { if (dernier >= 0) marquer(dernier, false); dernier = -1; t.hidden = true; });
    };
    dessiner();
    D.graphiques.push(dessiner);
  }
  let minuteur = null;
  window.addEventListener("resize", () => { clearTimeout(minuteur); minuteur = setTimeout(() => D.graphiques.forEach((f) => f()), 150); });

  // ------------------------------------------------------------- journées, fenêtres
  function joursFenetre(fenetre) {
    const js = D.meta.journees.map((j) => j.jour);
    return fenetre === "tout" || !fenetre ? js : js.slice(-Number(fenetre));
  }
  const journee = (jour) => D.meta.journees.find((j) => j.jour === jour) || null;
  const noteJour = (jour) => { const j = journee(jour); return j && !j.complet ? `<div class="n">${j.en_cours ? "Journée en cours" : "Collecte incomplète"} : ${heuresTxt(j.heures)} relevées</div>` : ""; };

  // ------------------------------------------------------- tables d'objets
  /* En-tête de liste : cols = [{ t, num, tri, aide }]. Le tri actif porte une flèche. */
  function entetes(cols, triActif) {
    return `<thead><tr>${cols.map((c) => {
      const actif = c.tri && (c.tri === triActif || (c.tri === "hausse" && triActif === "baisse"));
      const lib = esc(c.t) + (actif ? (triActif === "baisse" ? " ▴" : " ▾") : "");
      return `<th scope="col" class="${c.num ? "num" : ""}${actif ? " actif" : ""}">${c.tri ? `<button type="button" class="tri" data-tri="${c.tri}" title="Trier">${lib}</button>` : lib}${c.aide ? " " + aide(c.aide) : ""}</th>`;
    }).join("")}</tr></thead>`;
  }
  const blocNom = (o, sous) => `<div><a class="nom ${qcl(o.qual)}" href="#/objet/${o.id}" title="${esc(QUAL_LIB[o.qual] || "")}">${esc(o.nom)}</a>${sous ? `<span class="en">${sous}</span>` : ""}</div>`;
  const sousNom = (o) => esc([o.en, o.sc || o.classe].filter(Boolean).join(" · "));
  /* Une ligne d'objet des listes (classement, recherche, mes objets) : cinq cellules.
     x = { o, med, pl, vj, valj, taux, depj, infos } ; extra = [libellé, html] montré à la place de la courbe sur téléphone. */
  function ligneObjet(x, extra, secEcoul) {
    const o = x.o;
    return `<tr data-lien="#/objet/${o.id}"${x.infos ? ` title="${esc(x.infos)}"` : ""}>
      <td class="c-objet"><div class="obj">${boutonEpingle(o)}${blocNom(o, sousNom(o))}</div></td>
      <td class="c-tete num">${pieces(x.med)}${nb(x.pl) ? `<span class="sec">plancher ${pieces(x.pl)}</span>` : ""}</td>
      <td class="c-a${extra ? " avec-extra" : ""}">${celluleTendance(o)}${extra ? `<div class="extra"><span>${esc(extra[0])}</span> ${extra[1]}</div>` : ""}</td>
      <td class="c-b num"><b>${fmtQ(x.vj)}</b><span class="u">${NBSP}/j</span>${nb(x.valj) ? `<span class="sec">${montant(x.valj)} par jour</span>` : ""}</td>
      <td class="c-c">${jauge(x.taux)}${secEcoul || (nb(x.depj) ? `<span class="sec">${fmtQ(x.depj)} déposés par jour</span>` : "")}</td></tr>`;
  }
  const COLS_OBJETS = () => [{ t: "Objet", tri: "nom" }, { t: "Prix médian vendu", num: true, tri: "med", aide: "mediane" },
    D.courbes ? { t: `Prix sur ${nCourbe()} jours`, tri: "hausse", aide: "courbe" } : { t: "Tendance", tri: "hausse", aide: "tendance" },
    { t: "Vendus par jour", num: true, tri: "vendus", aide: "ventes" }, { t: "Écoulement", tri: "taux", aide: "ecoulement" }];
  const ligneRien = (texte) => `<tr><td colspan="5" class="rien">${esc(texte)}</td></tr>`;
  const deIndex = (o) => ({ o, med: o.mv7, pl: o.pl, vj: o.vj, valj: o.valj, taux: o.taux, depj: o.dep,
    infos: `${classeTexte(o) || "classe inconnue"} · vu du ${dateFr(o.premier, true)} au ${dateFr(o.dernier, true)}` });

  // ------------------------------------------------------------------ accueil
  function rang(o, opt = {}) {
    const vis = opt.vis != null ? opt.vis : (D.courbes ? mini(courbe(o.id) || [], { w: 84, h: 24, label: `Prix médian vendu de ${o.nom} sur ${nCourbe()} jours` }) : "");
    return `<div class="rang${opt.retirable ? " x" : ""}${vis ? "" : " sans-vis"}" data-lien="#/objet/${o.id}">${blocNom(o, esc(o.en))}${vis ? `<span class="r-vis">${vis}</span>` : ""}<span class="r-prix">${pieces(opt.prix)}</span><span class="r-val">${opt.val}</span>`
      + (opt.retirable ? boutonEpingle(o) : "") + "</div>";
  }
  const rangVar = (o, retirable) => rang(o, { retirable, prix: D.courbes ? (dernierCours(o.id) ?? o.mv1) : o.mv1,
    val: D.courbes ? variation(var14(o.id), null, `Sur ${nCourbe()} jours`) : variation(o.tend, null, "Dernier jour contre la médiane des 7 jours") });
  const rangStock = (o) => rang(o, { vis: `${fmtQ(o.vj)} par jour`, prix: o.mv7, val: `<span class="stock" title="${fmtN(o.st)} en vente au dernier relevé">${fmtN(o.hs, 1)}${NBSP}h</span>` });
  function blocMes() {
    const xs = epingles.map((i) => D.parId.get(i)).filter(Boolean);
    return xs.length ? xs.slice(0, 8).map((o) => rangVar(o, true)).join("") + (xs.length > 8 ? `<p class="vide"><a href="#/mes-objets">Les ${xs.length} objets épinglés</a></p>` : "")
      : '<p class="vide">Aucun objet épinglé. Touchez l\'étoile d\'un objet, dans une liste ou sur sa fiche, pour le retrouver ici.</p>';
  }
  function vueAccueil() {
    const vue = $("#vue"), m = D.meta;
    titre("");
    const complets = (m.journees || []).filter((j) => j.complet), der = complets[complets.length - 1], prec = complets[complets.length - 2];
    const tuiles = [];
    const mar = m.marche || {};
    /* Le bloc s'appelle « aujourd'hui » : il montre en grand la journée en cours (non finalisée, c'est dit), comparée à la veille
       à la même heure quand les deux journées ont le même nombre de relevés, et rappelle dessous la dernière journée complète. */
    const cours = (m.journees || []).find((j) => j.en_cours) || null, ors = complets.slice(-14).map((j) => j.valeur);
    const veilleDe = (jour) => { const d = new Date(jour + "T12:00:00"); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
    const hier = !!(cours && der && der.jour === veilleDe(cours.jour));
    const figure = ors.length > 1 ? `<figure><a href="#/marche" aria-label="Voir l'or échangé par jour sur 30 jours">${mini(ors, { w: 190, h: 58, couleur: "var(--accent)", label: `Or échangé par jour sur ${ors.length} journées complètes` })}</a><figcaption>${ors.length} jours<span class="pp"> complets</span></figcaption></figure>` : "";
    const lienOr = `<a class="lien-bloc" href="#/marche">Voir l'or échangé par jour sur 30 jours</a>`;
    if (cours) {
      const ec = mar.en_cours, comparable = ec && ec.jour === cours.jour && ec.veille_valeur > 0 && ec.releves > 0 && ec.veille_releves === ec.releves;
      const rappel = der ? `<div class="rappel"><span>${hier ? "Hier" : "Dernière journée complète"}, ${esc(dateFr(der.jour))}${hier ? ", journée complète" : ""} : <b>${montant(der.valeur)}</b></span>${prec && prec.valeur ? `<span class="nw">${variation(der.valeur / prec.valeur - 1)}</span><span>contre ${esc(dateFr(prec.jour))}, la journée complète précédente</span>${noteEcartees(m.journees, prec, der)}` : ""}</div>` : "";
      tuiles.push(`<div class="cle-t heros"><div><div class="l">Or échangé aujourd'hui, ${esc(dateFr(cours.jour))} ${aide("or")}</div><div class="h-tete"><div class="v">${montant(cours.valeur)}</div>${figure}</div>
        <div class="d"><span>Journée en cours, non finalisée : ${heuresTxt(cours.heures)} relevées sur 24</span></div>
        ${comparable ? `<div class="d">${variation(ec.valeur / ec.veille_valeur - 1)}<span>contre ${hier ? "hier" : esc(dateFr(ec.veille))} à la même heure</span></div>` : ""}
        ${rappel}${lienOr}</div></div>`);
      const cu = `<span>Journée en cours, non finalisée : ${heuresTxt(cours.heures)} relevées</span>`;
      tuiles.push(`<div class="cle-t"><div class="l">Unités vendues aujourd'hui ${aide("ventes")}</div><div class="v">${fmtN(cours.vendus)}</div><div class="d">${cu}</div>${der ? `<div class="d"><span>${hier ? "Hier" : esc(dateFr(der.jour, true))}, journée complète : ${fmtN(der.vendus)}</span></div>` : ""}</div>`);
    } else if (der) {
      tuiles.push(`<div class="cle-t heros"><div><div class="l">Or échangé, ${esc(dateFr(der.jour))} ${aide("or")}</div><div class="h-tete"><div class="v">${montant(der.valeur)}</div>${figure}</div>
        <div class="d"><span>Dernière journée complète, aucune journée en cours</span></div>
        ${prec && prec.valeur ? `<div class="d">${variation(der.valeur / prec.valeur - 1)}<span>contre ${esc(dateFr(prec.jour))}, la journée complète précédente</span>${noteEcartees(m.journees, prec, der)}</div>` : ""}
        ${lienOr}</div></div>`);
      tuiles.push(`<div class="cle-t"><div class="l">Unités vendues ${aide("ventes")}</div><div class="v">${fmtN(der.vendus)}</div><div class="d">${prec && prec.vendus ? variation(der.vendus / prec.vendus - 1) : ""}<span>${esc(dateFr(der.jour, true))}, journée complète</span></div></div>`);
    }
    if (nb(mar.valeur_24h)) tuiles.push(`<div class="cle-t"><div class="l">Dernières 24 heures ${aide("h24")}</div><div class="v">${montant(mar.valeur_24h)}</div><div class="d">${nb(mar.vendus_24h) ? `<span>${fmtN(mar.vendus_24h)} unités vendues</span>` : ""}</div></div>`);
    if (nb(mar.annonces)) tuiles.push(`<div class="cle-t"><div class="l">Annonces en vente ${aide("annonces")}</div><div class="v">${fmtN(mar.annonces)}</div><div class="d">${nb(mar.objets) ? `<span>${fmtN(mar.objets)} objets différents</span>` : ""}</div></div>`);
    tuiles.push(`<div class="cle-t"><div class="l">Objets suivis ${aide("suivis")}</div><div class="v">${fmtN(m.n_objets ?? D.index.length)}</div><div class="d"><span>${fmtN(D.index.filter((o) => o.vj > 0).length)} vendus en 7 jours</span></div></div>`);
    const cand = D.index.filter(soutenu).map((o) => ({ o, v: variationDe(o) })).filter((x) => nb(x.v));
    const monte = cand.filter((x) => x.v >= 0.005).sort((a, b) => b.v - a.v).slice(0, 5).map((x) => x.o);
    const baisse = cand.filter((x) => x.v <= -0.005).sort((a, b) => a.v - b.v).slice(0, 5).map((x) => x.o);
    const manque = D.index.filter((o) => soutenu(o) && hsUtile(o) != null && o.hs < SEUIL.manque_h).sort((a, b) => a.hs - b.hs).slice(0, 5);
    const sousVar = D.courbes ? `Prix médian vendu, variation sur ${nCourbe()} j` : "Prix du dernier jour contre la médiane des 7 jours";
    const bloc = (id, t, cleAide, lien, sous, corps) => `<section class="carte" aria-labelledby="t-${id}"><div class="carte-tete"><h2 id="t-${id}">${t}</h2>${aide(cleAide)}${lien ? `<a class="lien" href="${lien}">Tout voir</a>` : ""}</div><p class="carte-sous">${sous}</p><div id="a-${id}">${corps}</div></section>`;
    vue.innerHTML = `
      <div class="titre-page"><h1>Le marché aujourd'hui</h1><p class="sous">Hôtel des ventes de la Horde, ${esc(dateFr(m.dernier_jour))}</p></div>
      <div class="cles" data-n="${tuiles.length}">${tuiles.join("")}</div>
      <div class="blocs">
        ${bloc("monte", "Ce qui monte", D.courbes ? "monte" : "monteJ", "#/classement?tri=hausse&soutenu=1", sousVar, monte.map((o) => rangVar(o)).join("") || '<p class="vide">Aucune hausse parmi les objets aux ventes soutenues.</p>')}
        ${bloc("baisse", "Ce qui baisse", D.courbes ? "monte" : "monteJ", "#/classement?tri=baisse&soutenu=1", sousVar, baisse.map((o) => rangVar(o)).join("") || '<p class="vide">Aucune baisse parmi les objets aux ventes soutenues.</p>')}
        ${bloc("manque", "Ce qui manque", "manque", "#/classement?tri=stock&soutenu=1", "Peu d'heures de stock pour une demande forte", manque.map(rangStock).join("") || '<p class="vide">Rien ne manque : les objets aux ventes soutenues ont tous plus de 6 heures de stock.</p>')}
        ${bloc("mes", "Mes objets", "mes", epingles.length ? "#/mes-objets" : "", "Épinglés dans ce navigateur", blocMes())}
      </div>`;
    D.rafraichir = () => { const el = $("#a-mes"); if (el) el.innerHTML = blocMes(); };
  }

  // ------------------------------------------------------------------ or par jour
  /* L'or échangé jour par jour sur trente jours (meta.journees) : le graphique derrière la tuile de l'accueil. La journée en
     cours et les journées de collecte incomplète sont montrées sous une bande grise et écartées des moyennes ; l'or par heure
     couverte permet de les comparer quand même aux autres. Deux mesures, deux graphiques : jamais deux échelles sur un axe. */
  function vueMarche() {
    const vue = $("#vue"), js = (D.meta.journees || []).slice(-30), n = js.length;
    titre("Or échangé par jour");
    if (!n) { vue.innerHTML = `<a class="retour" href="#/accueil">← Le marché aujourd'hui</a><div class="titre-page"><h1>Or échangé par jour</h1></div><p class="rien">Aucune journée relevée.</p>`; return; }
    const complets = js.filter((j) => j.complet), der = complets[complets.length - 1], prec = complets[complets.length - 2], cours = js.find((j) => j.en_cours) || null;
    const sept = complets.slice(-7), moy7 = sept.length ? Math.round(sept.reduce((a, j) => a + j.valeur, 0) / sept.length) : null;
    const parHeure = (j) => j.heures > 0 ? Math.round(j.valeur / j.heures) : null, OR = "var(--accent)";
    const meilleur = complets.length ? complets.reduce((a, j) => j.valeur > a.valeur ? j : a) : null;
    const tuiles = [];
    if (der) tuiles.push(`<div class="cle-t"><div class="l">Dernière journée complète ${aide("or")}</div><div class="v">${montant(der.valeur)}</div><div class="d">${prec && prec.valeur ? variation(der.valeur / prec.valeur - 1) : ""}<span>${esc(dateFr(der.jour))}</span></div>${prec && prec.valeur ? `<div class="d"><span>contre ${esc(dateFr(prec.jour))}, la journée complète précédente</span>${noteEcartees(js, prec, der)}</div>` : ""}</div>`);
    if (cours) tuiles.push(`<div class="cle-t"><div class="l">Aujourd'hui, en cours</div><div class="v">${montant(cours.valeur)}</div><div class="d"><span>${heuresTxt(cours.heures)} relevées sur 24${parHeure(cours) != null && der && parHeure(der) ? `, ${montant(parHeure(cours))} par heure contre ${montant(parHeure(der))}` : ""}</span></div></div>`);
    if (moy7 != null) tuiles.push(`<div class="cle-t"><div class="l">Moyenne par jour</div><div class="v">${montant(moy7)}</div><div class="d"><span>sur les ${sept.length} dernières journées complètes</span></div></div>`);
    const incomplet = js.some((j) => !j.complet);
    const legende = incomplet ? '<div class="legende"><span><span class="cle rect" style="background:var(--bg-3)"></span>collecte incomplète ou en cours</span></div>' : "";
    const etat = (j) => j.en_cours ? "en cours" : j.complet ? "complète" : "incomplète";
    const nomme = (i, slot) => etiquettesFin(n, slot, 44)(i) ? dateCourt(js[i].jour) : null;
    const note = (j) => j.complet ? "" : `<div class="n">${j.en_cours ? "Journée en cours" : "Collecte incomplète"} : ${heuresTxt(j.heures)} relevées</div>`;
    vue.innerHTML = `
      <a class="retour" href="#/accueil">← Le marché aujourd'hui</a>
      <div class="titre-page"><h1>Or échangé par jour</h1><p class="sous">Hôtel des ventes de la Horde, ${n} jour${n > 1 ? "s" : ""} relevé${n > 1 ? "s" : ""}, du ${esc(dateFr(js[0].jour, true))} au ${esc(dateFr(js[n - 1].jour, true))}</p></div>
      <div class="cles" data-n="${tuiles.length}">${tuiles.join("")}</div>
      <section class="carte" aria-labelledby="t-or"><div class="carte-tete"><h2 id="t-or">Or échangé par jour</h2>${aide("or")}</div>
        <p class="carte-sous">En pièces d'or, somme des ventes estimées de chaque journée${meilleur ? `. Plus forte journée complète : ${esc(dateFr(meilleur.jour))}` : ""}.</p>
        ${legende}<div class="graphique" id="g-or"></div>
        <details class="tableau-vue"><summary>Les mêmes données en tableau</summary><div class="tv-cadre"><table class="tv"><thead><tr><th scope="col">Jour</th><th scope="col">Or échangé</th><th scope="col">Unités vendues</th><th scope="col">Or par heure relevée</th><th scope="col">Heures relevées</th><th scope="col">Relevés</th><th scope="col">Journée</th></tr></thead><tbody>
          ${[...js].reverse().map((j) => `<tr><td>${esc(dateFr(j.jour, true))}</td><td>${montant(j.valeur)}</td><td>${fmtN(j.vendus)}</td><td>${parHeure(j) != null ? montant(parHeure(j)) : VIDE}</td><td>${heuresTxt(j.heures)}</td><td>${fmtN(j.releves)}</td><td>${etat(j)}</td></tr>`).join("")}</tbody></table></div></details></section>
      <section class="carte" aria-labelledby="t-un"><div class="carte-tete"><h2 id="t-un">Unités vendues par jour</h2>${aide("ventes")}</div>
        <p class="carte-sous">Toutes les unités comptées vendues dans la journée, munitions comprises.</p>
        ${legende}<div class="graphique" id="g-un"></div></section>`;
    barres($("#g-or"), { n, H: 240, titre: "Or échangé par jour, en pièces d'or.", bande: (i) => !js[i].complet, piles: (i) => [{ v: js[i].valeur / 10000, c: OR }], nomme,
      etiquette: (i) => meilleur && js[i] === meilleur ? `${fmtN(Math.round(js[i].valeur / 10000))} or` : null,
      bulle: (i) => { const j = js[i]; return `<div class="t">${esc(dateFr(j.jour))}</div>` + rangee(OR, "Or échangé", montant(j.valeur)) + rangee(null, "Unités vendues", fmtN(j.vendus))
        + (parHeure(j) != null ? rangee(null, "Or par heure relevée", montant(parHeure(j))) : "") + rangee(null, "Heures relevées", `${heuresTxt(j.heures)}, ${fmtN(j.releves)} relevés`) + note(j); } });
    barres($("#g-un"), { n, H: 200, titre: "Unités vendues par jour.", bande: (i) => !js[i].complet, piles: (i) => [{ v: js[i].vendus, c: C.vendus }], nomme,
      bulle: (i) => { const j = js[i]; return `<div class="t">${esc(dateFr(j.jour))}</div>` + rangee(C.vendus, "Unités vendues", fmtN(j.vendus)) + rangee(null, "Or échangé", montant(j.valeur)) + note(j); } });
  }

  // ------------------------------------------------------------------- classement
  const TRIS = [["valeur", "Or échangé"], ["vendus", "Volume"], ["med", "Prix"], ["hausse", "Hausse"], ["baisse", "Baisse"], ["taux", "Écoulement"], ["stock", "Peu de stock"], ["dep", "Unités déposées"], ["pl", "Plancher"], ["nom", "Nom"]];
  const ALIAS_TRI = { or: "valeur", prix: "med", ecoulement: "taux", volume: "vendus" };
  function optionsClasse(classe, sc) {
    let h = '<option value="|">Toutes</option>';
    for (const [c, scs] of Object.entries(D.meta.classes || {})) {
      const ss = (scs || []).filter((s) => s && s !== c), sel = (s) => (c === classe && s === sc ? " selected" : "");
      h += ss.length ? `<optgroup label="${esc(c)}"><option value="${esc(c)}|"${sel("")}>${esc(c)}, tout</option>${ss.map((s) => `<option value="${esc(c)}|${esc(s)}"${sel(s)}>${esc(s)}</option>`).join("")}</optgroup>`
        : `<option value="${esc(c)}|"${c === classe ? " selected" : ""}>${esc(c)}</option>`;
    }
    return h;
  }
  async function vueClassement(p, vivant) {
    const vue = $("#vue"), periodes = D.meta.periodes || [];
    titre("Ce qui se vend");
    let cle = p.get("periode") || "g-7";
    if (!periodes.some((x) => x.cle === cle)) cle = (periodes.find((x) => x.cle === "g-7") || periodes[periodes.length - 1] || {}).cle;
    const per = periodes.find((x) => x.cle === cle);
    if (!per) { vue.innerHTML = '<div class="titre-page"><h1>Ce qui se vend</h1></div><p class="attente">Aucune période disponible.</p>'; return; }
    const classe = p.get("classe") || "", sc = p.get("sc") || "", soutenuSeul = p.get("soutenu") === "1";
    let tri = p.get("tri") || "valeur"; tri = ALIAS_TRI[tri] || tri; if (!TRIS.some(([k]) => k === tri)) tri = "valeur";
    const jours = periodes.filter((x) => x.type === "jour").slice(-14).reverse(), semaines = periodes.filter((x) => x.type === "semaine").slice(-12).reverse();
    const opt = (x) => `<option value="${esc(x.cle)}"${x.cle === cle ? " selected" : ""}>${esc(x.libelle)}</option>`;
    vue.innerHTML = `
      <div class="titre-page"><h1>Ce qui se vend</h1>${aide("ventes")}<p class="sous">${esc(per.libelle)} : ${fmtN(per.jours)} jour${per.jours > 1 ? "s" : ""}, ${heuresTxt(per.heures)} couvertes${per.complet ? "" : ", période incomplète"}</p></div>
      <div class="barre">
        <label class="champ"><span>Période</span><select id="f-periode">
          <optgroup label="Fenêtres">${periodes.filter((x) => x.type === "glissant").map(opt).join("")}</optgroup>
          <optgroup label="Jours">${jours.map(opt).join("")}</optgroup>
          <optgroup label="Semaines">${semaines.map(opt).join("")}</optgroup></select></label>
        <label class="champ"><span>Autre jour</span><input type="date" id="f-jour" min="${esc(D.meta.premier_jour)}" max="${esc(D.meta.dernier_jour)}" value="${per.type === "jour" ? esc(per.debut) : ""}"></label>
        <label class="champ"><span>Classe</span><select id="f-classe">${optionsClasse(classe, sc)}</select></label>
        <label class="champ"><span>Tri</span><select id="f-tri">${TRIS.map(([k, v]) => `<option value="${k}"${k === tri ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="champ large"><span>Filtrer</span><input type="search" id="f-q" value="${esc(p.get("q") || "")}" placeholder="nom français ou anglais"></label>
        <span class="coche-groupe"><label class="coche"><input type="checkbox" id="f-soutenu"${soutenuSeul ? " checked" : ""}> Ventes soutenues</label>${aide("soutenu")}</span>
        <span class="compte" id="c-compte" role="status"></span>
      </div>
      <div class="liste-cadre"><table class="liste">${entetes(COLS_OBJETS(), tri)}<tbody id="c-corps"><tr><td colspan="5" class="rien">Chargement de la période…</td></tr></tbody></table></div>
      <div class="centre" id="c-plus"></div>`;
    $("#f-periode").addEventListener("change", (e) => majHash({ periode: e.target.value }));
    $("#f-jour").addEventListener("change", (e) => { if (e.target.value && periodes.some((x) => x.cle === "j-" + e.target.value)) majHash({ periode: "j-" + e.target.value }); });
    $("#f-classe").addEventListener("change", (e) => { const [c, s] = e.target.value.split("|"); majHash({ classe: c, sc: s }); });
    $("#f-tri").addEventListener("change", (e) => majHash({ tri: e.target.value }));
    $("#f-soutenu").addEventListener("change", (e) => majHash({ soutenu: e.target.checked ? "1" : "" }));
    D.surTri = (t) => majHash({ tri: t === "hausse" && tri === "hausse" ? "baisse" : t });
    let filtre = p.get("q") || "", limite = 300;
    const doc = await charger(`data/periodes/${cle}.json`);
    if (!vivant()) return;
    const jp = per.heures / 24 || 1;
    const lignes = tab(doc.colonnes, doc.lignes).map((r) => ({ o: D.parId.get(r.id), vendus: r.vendus || 0, valeur: r.valeur || 0, med: r.med_vendu ?? null, pl: r.plancher ?? null, vus: r.jours_vus, dep: r.deposes || 0, taux: r.taux ?? null })).filter((x) => x.o);
    const inf = Infinity, vv = (x) => variationDe(x.o);
    const cmp = { valeur: (a, b) => b.valeur - a.valeur, vendus: (a, b) => b.vendus - a.vendus, dep: (a, b) => b.dep - a.dep,
      taux: (a, b) => ((b.taux ?? -1) - (a.taux ?? -1)) || (b.vendus - a.vendus), med: (a, b) => (b.med || 0) - (a.med || 0), pl: (a, b) => (b.pl || 0) - (a.pl || 0),
      nom: (a, b) => a.o.nom.localeCompare(b.o.nom, "fr"),
      hausse: (a, b) => ((vv(b) ?? -inf) - (vv(a) ?? -inf)) || (b.valeur - a.valeur), baisse: (a, b) => ((vv(a) ?? inf) - (vv(b) ?? inf)) || (b.valeur - a.valeur),
      stock: (a, b) => ((hsUtile(a.o) ?? inf) - (hsUtile(b.o) ?? inf)) || (b.valeur - a.valeur) }[tri];
    const rendre = () => {
      const fq = norm(filtre.trim());
      let sel = lignes.filter((x) => (!classe || x.o.classe === classe) && (!sc || x.o.sc === sc) && (!soutenuSeul || soutenu(x.o)) && (!fq || x.o.k.includes(fq)));
      sel.sort(cmp);
      const total = sel.length; sel = sel.slice(0, limite);
      $("#c-corps").innerHTML = sel.map((x) => {
        const extra = tri === "pl" ? ["plancher", pieces(x.pl)] : tri === "dep" ? ["déposés", `${fmtQ(x.dep / jp)}${NBSP}/j`] : tri === "stock" ? ["stock", heuresTxt(hsUtile(x.o))] : null;
        return ligneObjet({ o: x.o, med: x.med, pl: x.pl, vj: x.vendus / jp, valj: x.valeur / jp, taux: x.taux, depj: x.dep / jp,
          infos: `${classeTexte(x.o) || "classe inconnue"} · ${fmtN(x.vendus)} vendus et ${fmtN(x.dep)} déposés sur la période · ${prixTexte(x.valeur)} · vu ${fmtN(x.vus)} jour${x.vus > 1 ? "s" : ""} sur ${fmtN(per.jours)}` },
          extra, tri === "stock" ? `<span class="sec">${heuresTxt(hsUtile(x.o))} de stock</span>` : null);
      }).join("") || ligneRien("Aucun objet vendu ne correspond.");
      $("#c-compte").textContent = total > limite ? `${fmtN(limite)} affichés sur ${fmtN(total)} objets` : `${fmtN(total)} objet${total > 1 ? "s" : ""}`;
      $("#c-plus").innerHTML = total > limite ? `<button type="button" class="bouton" id="c-encore">Afficher la suite (${fmtN(total - limite)} de plus)</button>` : "";
      const b = $("#c-encore"); if (b) b.addEventListener("click", () => { limite += 300; rendre(); });
      majEpingles();
    };
    rendre();
    $("#f-q").addEventListener("input", (e) => { filtre = e.target.value; limite = 300; noterParam("q", filtre.trim()); rendre(); });
  }

  // ------------------------------------------------------------------------ fiche
  const VERDICTS = ["Oui, vite", "Oui, lentement", "Mal"];
  const ICONES_V = ['<path d="M8 14.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M14 8v6.5l4 2.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    '<path d="M9.5 9.5l9 9M18.5 9.5l-9 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'];
  /* 25/11/2026 (le Chaperon terrestre en soie, « Oui, vite » à deux fois sa médiane vendue) : le délai au prix
     conseillé, borné par l'écoulement des 7 jours ; rien de vendu à ce prix ou plus en 7 jours, « Mal ». */
  function verdictDe(o, conseil) {
    const vj = o.vj || 0;
    if (vj < 1) return 2;
    if (conseil && conseil.ventes_j_prix === 0) return 2;
    if (conseil && nb(conseil.delai_h)) {
      const parDelai = conseil.delai_h <= 4 ? 0 : conseil.delai_h <= 24 ? 1 : 2;
      const borne = nb(o.taux) ? (o.taux < 0.15 ? 2 : o.taux < 0.4 ? 1 : 0) : 0;
      return Math.max(parDelai, borne);
    }
    if (nb(o.taux) && o.taux < 0.15) return 2;
    return vj >= 24 && nb(o.taux) && o.taux >= 0.4 ? 0 : 1;
  }
  function delaiTxt(hh) {
    if (!nb(hh)) return null;
    if (hh < 1) return "moins d'1 h";
    if (hh < 48) return `environ ${fmtN(hh, hh < 10 ? 1 : 0)}${NBSP}h`;
    return `environ ${fmtN(hh / 24)}${NBSP}j`;
  }
  function lireFourchette(f) {
    const m = new Map();
    if (!f || !Array.isArray(f.jours) || !Array.isArray(f.colonnes)) return m;
    for (const r of tab(f.colonnes, f.jours)) if (r.jour && nb(r.surs)) m.set(r.jour, { surs: r.surs || 0, probables: r.probables || 0, possibles: r.possibles || 0, exclus: nb(r.exclus) ? r.exclus : null });
    return m;
  }
  const enteteObjet = (o) => `<a class="retour" href="#/classement">← Ce qui se vend</a><div class="o-tete"><h1 class="${qcl(o.qual)}">${esc(o.nom)}</h1>${boutonEpingle(o, true)}</div>`;
  async function vueObjet(id, p, vivant) {
    const vue = $("#vue"), o = D.parId.get(id);
    if (!o) { titre("Objet inconnu"); vue.innerHTML = `<a class="retour" href="#/classement">← Ce qui se vend</a><div class="titre-page"><h1>Objet ${Number.isFinite(id) ? esc(id) : "inconnu"}</h1></div><p class="attente">Cet objet n'a pas été vu à l'hôtel des ventes depuis le début de la collecte.</p>`; return; }
    titre(o.nom);
    const FEN = [["7", "7 j"], ["14", "14 j"], ["30", "30 j"], ["90", "90 j"], ["tout", "Tout"]];
    const fenetre = FEN.some(([k]) => k === p.get("fenetre")) ? p.get("fenetre") : "30";
    vue.innerHTML = enteteObjet(o) + '<p class="attente">Chargement de la fiche…</p>';
    majEpingles();
    const doc = await charger(`data/objets/${id}.json`);
    if (!vivant()) return;
    const lj = tab(doc.colonnes, doc.jours), parJour = new Map(lj.map((l) => [l.jour, l])), four = lireFourchette(doc.fourchette);
    const premier = lj.length ? lj[0].jour : null, tous = D.meta.journees.map((j) => j.jour).filter((j) => !premier || j >= premier);
    const jours = joursFenetre(fenetre).filter((j) => !premier || j >= premier), serie = jours.map((j) => parJour.get(j) || null);
    /* ventes d'un jour : la fourchette quand elle existe (valeur centrale = sûres + probables), sinon le chiffre habituel */
    const ventes = (l) => { const f = l && four.get(l.jour); return f ? { v: f.surs + f.probables, lo: f.surs, hi: f.surs + f.probables + f.possibles, f } : { v: l ? (l.vendus || 0) : 0, f: null }; };
    const ventesTxt = (l) => { const x = ventes(l); return x.f && x.hi > x.lo ? `de ${fmtN(x.lo)} à ${fmtN(x.hi)}` : fmtN(x.v); };
    const f7 = new Set(D.meta.fenetre_jours || []);
    let v7 = 0, ex7 = 0, val7 = 0, dep7 = 0;
    for (const l of lj) if (f7.has(l.jour)) { v7 += l.vendus || 0; ex7 += l.expires || 0; val7 += l.valeur || 0; dep7 += l.deposes || 0; }
    const dl = lj[lj.length - 1] || {}, stockFin = dl.stock_fin != null ? dl.stock_fin : dl.stock;
    const c = doc.conseil && nb(doc.conseil.prix) ? doc.conseil : null, niveau = verdictDe(o, c);
    const heuresOk = Array.isArray(doc.heures) && doc.heures.length ? doc.heures.filter(nb) : null, heuresLib = heuresOk ? heuresOk.map((x) => `${x}${NBSP}h`).join(", ") : null;
    /* Camp des recettes : l'objet est lui-même un plan réservé, ou une recette qui le fabrique l'est. */
    const fab = doc.fabrique_par || [], campsDoc = doc.camps || {}, pcamp = doc.plan_camp || null;
    const AP = fab.length || pcamp ? await chargerFacultatif("data/apprendre.json") : null;
    if (!vivant()) return;
    /* L'objet est lui-même un plan : où le trouver, hors de cet hôtel des ventes. */
    const ouPlan = pcamp && AP ? cheminsPlan(id, AP, { ici: false, max: 6 }) : [];
    const blocPlan = blocApprendre(ouPlan, `Où trouver ${LE_PLAN[motPlan(null, pcamp && pcamp.nom)].replace(/^l[ea] /, "ce ").replace("ce formule", "cette formule")}, hors de cet hôtel des ventes`);
    /* L'objet se fabrique : comment apprendre chaque recette qui le donne, en haut de la fiche (forme courte, le détail
       est sur la page de la recette). */
    const lignesFab = AP ? fab.flatMap((r) => { const cc = cheminsRecette(r[0], AP, r[1], r[3], { court: true });
      return cc.length ? [{ tete: true, t: metierFr(r[1]), h: `<a href="#/recette/${r[0]}">${esc(r[2] || "recette " + r[0])}</a>${r[3] > 1 ? `, niveau ${fmtN(r[3])}` : ""}` }, ...cc] : []; }) : [];
    const blocFab = blocApprendre(lignesFab, fab.length > 1 ? "Comment apprendre à le fabriquer : une recette suffit" : "Comment apprendre à le fabriquer");
    /* L'objet se fabrique : ce que coûte une fabrication et ce qu'elle laisse (demande d'Emmanuel du 23/11/2026 sur la fiche
       du Heaume orné en mithril : le coût n'était que sur la page de la recette). Ce sont les chiffres de l'onglet Artisanat
       et de la page de la recette (data/artisanat.json), pas un second calcul : coût des composants au prix du jour, marge
       nette à la médiane vendue des 7 jours, commission déduite, et la marge au plancher du moment quand elle existe. */
    const ART = fab.length ? avecRemise(await chargerFacultatif("data/artisanat.json")) : null;
    if (!vivant()) return;
    const lignesCout = [];
    if (ART && Array.isArray(ART.lignes)) {
      const parSpell = new Map(tab(ART.colonnes, ART.lignes).map((a) => [a.spell, a])), com = ART.commission || 0;
      /* Un composant jamais vu à l'hôtel des ventes n'est pas dans l'index, donc sans nom ici : le lien Wowhead dit ce que c'est. */
      const nomC = (i) => { const oc = D.parId.get(i); return oc ? `<a href="#/objet/${i}">${esc(oc.nom)}</a>` : `<a href="${WH(i)}" target="_blank" rel="noopener">objet ${esc(i)} ↗</a>`; };
      for (const r of fab) {
        const a = parSpell.get(r[0]);
        if (!a) continue;
        const comps = a.composants || [], sansPrix = comps.filter((x) => x[2] == null), qp = a.qp || 1, chiffree = a.etat !== "non_chiffrable" && nb(a.marge);
        lignesCout.push({ tete: true, t: metierFr(r[1]), h: `<a href="#/recette/${r[0]}">${esc(r[2] || "recette " + r[0])}</a>${qp !== 1 ? `, ${fmtN(qp, 2)} par fabrication` : ""} ${etqRecharge(a.recharge_h ?? null)}` });
        lignesCout.push({ t: "Coût", h: nb(a.cout) ? `<b>${pieces(a.cout)}</b> de composants par fabrication, au prix du ${esc(dateFr(ART.jour, true))}${ART.remise ? `, remise de ${ART.remise}${NBSP}% chez les marchands comptée` : ""}`
          : `<span class="nd">non chiffrable</span> : pas de prix pour ${sansPrix.length ? sansPrix.map((x) => nomC(x[0])).join(", ") : "un composant"}` });
        lignesCout.push({ t: "Marge nette", h: chiffree
          ? `<b>${pieces(a.marge)}</b> par fabrication, le produit vendu ${pieces(a.med_vendu_7j)} (médiane des 7 jours), commission de ${fmtN(100 * com)}${NBSP}% déduite${nb(a.marge_instant) ? ` ; au plancher du moment : ${pieces(a.marge_instant)}${mentionPlafond(a, ART.plancher_max)}` : ""}${a.fragile ? " " + etqFragile({ fragile: true, marge7: a.marge }) : ""}${c && nb(c.prix) && nb(a.cout) ? ` ; au prix conseillé, s'il trouve preneur : ${pieces(Math.round(qp * c.prix * (1 - com) - a.cout))}` : ""}`
          : `<span class="nd">non chiffrable aujourd'hui</span> : ${esc(RAISONS[a.raison] || "produit sans vente récente ou composant sans prix")}` });
        if (comps.length) lignesCout.push({ t: "Composants", h: comps.map(([i, q, pu, src]) => `${fmtN(q, 2)}${NBSP}× ${nomC(i)} <span class="nd">(${origineComp(ART, i, pu, src)})</span>`).join(", ") });
        if (aMarchand(ART, comps)) lignesCout.push({ t: "Ma remise", h: `${choixRemise()} <span class="nd">chez les marchands, selon votre réputation</span> ${aide("remise")}` });
      }
    }
    const blocCout = blocApprendre(lignesCout, fab.length > 1 ? "Coût de fabrication et marge, recette par recette" : "Coût de fabrication et marge", "artisanat");
    const nomRecette = (s, pid) => { const pr = D.parId.get(pid); return `<a href="#/recette/${s}">${esc(pr ? pr.nom : "la recette " + s)}</a>`; };
    const avisC = (pcamp ? avisCamp({ camp: pcamp.camp, lien: pcamp.lien, plan: id, info: pcamp, soi: true, enseigne: (pcamp.recettes || []).map(([s, pid]) => nomRecette(s, pid)).join(", ") }) : "")
      + fab.map((r) => avisCamp({ camp: r[5], lien: r[6], plan: r[7], metier: r[1], info: campsDoc[r[7]], recette: fab.length > 1 ? (r[2] || "recette " + r[0]) : null })).join("");
    /* Caisse détournée : elle rapporte de la Faveur de marchand, et la page #/faveur dit ce que cette Faveur achète. */
    const caissesFav = (D.meta.faveur && D.meta.faveur.caisses) || {}, ptsFav = caissesFav[id];
    const avisFav = id in caissesFav ? `<p class="avis-c mien"><b>Caisse détournée.</b> Remplie et remise, elle rapporte de la Faveur de marchand${nb(ptsFav) ? ` : <b>${fmtN(ptsFav)}</b> points de base, hors bonus de performance (valeur de l'addon WaylaidCost, à vérifier en jeu)` : ""}. <a href="#/faveur">Tout ce que la Faveur de marchand achète</a>.</p>` : "";
    const sous = [o.en ? esc(o.en) : null, o.classe ? `<b>${esc(classeTexte(o))}</b>` : null, o.qual ? `<b>${esc(QUAL_LIB[o.qual] || o.qual)}</b>` : null, nb(o.niv) ? `niveau ${o.niv}` : null, o.emp ? "empilable" : null,
      ...sourcesTexte(doc.sources, doc.noeud).map(esc), `<a href="${WH(o.id)}" target="_blank" rel="noopener">Wowhead ↗</a>`].filter(Boolean).join(" · ");
    const fj = [...four.values()];
    const fmoy = fj.length ? { lo: Math.round(fj.reduce((s, f) => s + f.surs, 0) / fj.length), hi: Math.round(fj.reduce((s, f) => s + f.surs + f.probables + f.possibles, 0) / fj.length), n: fj.length } : null;
    const preuves = [fmoy && fmoy.hi > 0 ? `<b>${fmtN(fmoy.lo)} à ${fmtN(fmoy.hi)}</b> vendus par jour (${fmoy.n} jour${fmoy.n > 1 ? "s" : ""} mesuré${fmoy.n > 1 ? "s" : ""})` : `<b>${fmtQ(o.vj)}</b> vendus par jour`, nb(o.st) ? `<b>${fmtN(o.st)}</b> en vente` : null, nb(o.taux) ? `écoulement <b>${pctTxt(o.taux)}</b>` : null, hsUtile(o) != null ? `<b>${heuresTxt(o.hs)}</b> de stock` : null,
      nb(o.mv7) ? `médiane 7 jours ${pieces(o.mv7)}` : null, nb(o.pl) ? `plancher ${pieces(o.pl)}` : null, !c && heuresLib ? `meilleures heures <b>${heuresLib}</b>` : null].filter(Boolean);
    const ventesP = c && nb(c.ventes_j_prix) ? `${fmtQ(c.ventes_j_prix)} par jour${nb(c.part_prix) ? `<span class="sec">${pctTxt(c.part_prix)} des ventes</span>` : ""}` : null;
    const faitsV = c ? [nb(c.duree_h) ? ["Durée d'annonce", `${fmtN(c.duree_h)}${NBSP}h`] : null,
      c.ventes_j_prix === 0 ? ["Délai de vente attendu", "aucune vente à ce prix en 7 jours"] : delaiTxt(c.delai_h) ? ["Délai de vente attendu", delaiTxt(c.delai_h)] : null,
      ventesP ? ["Ventes à ce prix ou plus", ventesP] : null, heuresLib ? ["Meilleures heures", heuresLib] : null].filter(Boolean) : [];
    const noteV = c ? [c.regle ? String(c.regle).replace(/\s*\.?\s*$/, ".") : null, nb(c.devant) ? `${fmtN(c.devant)} unité${c.devant > 1 ? "s" : ""} en vente à ce prix ou moins.` : null,
      nb(c.prix_quartile) ? `Le premier quartile des annonces est à ${prixTexte(c.prix_quartile)}, où presque rien ne se vend : la médiane vendue des ${c.fenetre || "7 jours"} est à ${prixTexte(c.mediane)}.` : null].filter(Boolean).join(" ") : "";
    const verdict = `<section class="verdict${c ? "" : " seul"}" aria-label="Verdict">
        <div class="v-g"><div class="v-q">Se vend-il ? ${aide("verdict")}</div>
          <div class="v-rep n${niveau}"><svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".7"/>${ICONES_V[niveau]}</svg>${VERDICTS[niveau]}</div>
          <ol class="v-echelle" aria-label="Échelle du verdict">${VERDICTS.map((v, i) => `<li class="${i === niveau ? `actif n${i}` : ""}"${i === niveau ? ' aria-current="true"' : ""}>${v}</li>`).join("")}</ol>
          <ul class="v-preuve">${preuves.map((x) => `<li>${x}</li>`).join("")}</ul></div>
        ${c ? `<div class="v-d"><div class="v-l">Prix conseillé pour poster ${aide("conseil")}</div><div class="v-prix">${pieces(c.prix)}</div>${noteV ? `<p class="v-note">${esc(noteV)}</p>` : ""}
          ${faitsV.length ? `<dl class="v-faits">${faitsV.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}</div>` : ""}
      </section>`;
    /* Ventes et annonces par prix (25/11/2026, demande d'Emmanuel : voir où l'objet se vend vraiment, pas seulement
       le plancher affiché) : sous le verdict, avant les courbes. */
    const vp = doc.ventes_prix && Array.isArray(doc.ventes_prix.tranches) && doc.ventes_prix.tranches.length ? doc.ventes_prix : null;
    let blocVP = "";
    if (vp) {
      const tr = vp.tranches.filter((x) => Array.isArray(x) && x.length === 4), rep = vp.reperes || {}, maxq = Math.max(1, ...tr.map((x) => Math.max(x[2] || 0, x[3] || 0)));
      /* bornes à deux chiffres significatifs : sans les zéros (« 1 po 20 », « 78 pa », « 1 pa 44 ») */
      const court = (x) => { const po = Math.floor(x / 10000), pa = Math.floor((x % 10000) / 100), pc = x % 100;
        return po ? `${po.toLocaleString("fr-FR")} po${pa || pc ? " " + p2(pa) : ""}${pc && po < 100 ? " " + p2(pc) : ""}` : pa ? `${pa} pa${pc ? " " + p2(pc) : ""}` : `${pc} pc`; };
      const borneTxt = ([bas, haut]) => bas == null ? `moins de ${court(haut)}` : haut == null ? `plus de ${court(bas)}` : bas === haut ? court(bas) : `${court(bas)} à ${court(haut)}`;
      const resume = [`<b>${fmtN(vp.vendus)}</b> vendu${vp.vendus > 1 ? "s" : ""} en ${fmtN(vp.jours, 1)}${NBSP}jours`, `<b>${fmtN(vp.en_vente)}</b> en vente au dernier relevé`,
        c && nb(c.part_prix) ? `<b>${pctTxt(1 - c.part_prix)}</b> des ventes sous le prix conseillé` : null].filter(Boolean).join(" · ");
      blocVP = `<section class="carte vp" aria-labelledby="t-vp"><div class="carte-tete"><h3 id="t-vp">Ventes et annonces par prix</h3>${aide("ventesPrix")}</div>
        <p class="carte-sous">${resume}</p>
        <div class="legende"><span><span class="cle rect" style="background:${C.vendus}"></span>vendus en 7 jours</span><span><span class="cle rect" style="background:${C.pl}"></span>en vente maintenant</span></div>
        <ul class="vp-l">${tr.map((x, i) => {
          const v = x[2] || 0, a = x[3] || 0, tags = (i === rep.conseil ? '<span class="vp-t c">prix conseillé</span>' : "") + (i === rep.mediane ? '<span class="vp-t m">médiane vendue</span>' : "");
          return `<li class="${i === rep.conseil ? "ic" : ""}${i === rep.mediane ? " im" : ""}"><span class="vp-p">${esc(borneTxt(x))}${tags}</span><span class="vp-b"><i style="width:${(100 * v / maxq).toFixed(1)}%;background:${C.vendus}"></i><i style="width:${(100 * a / maxq).toFixed(1)}%;background:${C.pl}"></i></span><span class="vp-q"><b title="vendus en 7 jours">${fmtN(v)}</b><span title="en vente maintenant">${fmtN(a)}</span></span></li>`;
        }).join("")}</ul></section>`;
    }
    /* cartes du bas : chacune n'existe que si sa donnée existe */
    const cartes = [], apres = [];
    const joursFour = jours.filter((j) => four.has(j));
    if (joursFour.length) {
      const ref = joursFour.filter((j) => f7.has(j)), base = ref.length ? ref : joursFour.slice(-1), moy = (fn) => base.reduce((a, j) => a + fn(four.get(j)), 0) / base.length;
      const lo = moy((f) => f.surs), hi = moy((f) => f.surs + f.probables + f.possibles), sansF = jours.some((j) => !four.has(j) && parJour.has(j));
      cartes.push(`<section class="carte" aria-labelledby="t-four"><div class="carte-tete"><h3 id="t-four">Ventes par jour, en fourchette</h3>${aide("fourchette")}</div>
        <div class="f-chiffres"><b>${hi > lo ? `${fmtN(lo)} à ${fmtN(hi)}` : fmtN(lo)}</b><span>ventes par jour, ${base.length > 1 ? `en moyenne sur ${base.length} jours mesurés` : `le ${esc(dateFr(base[0], true))}`}</span></div>
        <div class="legende"><span><span class="cle rect" style="background:${C.vendus}"></span>ventes sûres</span><span><span class="cle rect" style="background:${C.dep}"></span>probables et possibles en plus</span>${sansF ? `<span><span class="cle rect" style="background:${C.neutre}"></span>jour sans fourchette</span>` : ""}</div>
        <div class="graphique" id="g-four"></div>
        <details class="tableau-vue"><summary>Les mêmes données en tableau</summary><div class="tv-cadre"><table class="tv"><thead><tr><th scope="col">Jour</th><th scope="col">Sûres</th><th scope="col">Probables</th><th scope="col">Possibles</th><th scope="col">Fourchette</th><th scope="col">Sorties sans vente</th></tr></thead><tbody>
          ${[...joursFour].reverse().map((j) => { const f = four.get(j); return `<tr><td>${dateCourt(j)}</td><td>${fmtN(f.surs)}</td><td>${fmtN(f.probables)}</td><td>${fmtN(f.possibles)}</td><td>${fmtN(f.surs)} à ${fmtN(f.surs + f.probables + f.possibles)}</td><td>${fmtN(f.exclus)}</td></tr>`; }).join("")}</tbody></table></div></details></section>`);
      apres.push(() => barres($("#g-four"), { n: jours.length, titre: "Ventes sûres, probables et possibles par jour.", bande: (i) => { const j = journee(jours[i]); return j && !j.complet; },
        piles: (i) => { const f = four.get(jours[i]), l = serie[i]; return f ? [{ v: f.surs, c: C.vendus }, { v: f.probables + f.possibles, c: C.dep }] : [{ v: l ? l.vendus : 0, c: C.neutre }]; },
        nomme: (i, slot) => etiquettesFin(jours.length, slot, 44)(i) ? dateCourt(jours[i]) : null,
        bulle: (i) => { const f = four.get(jours[i]), l = serie[i]; return `<div class="t">${esc(dateFr(jours[i]))}</div>` + (f ? rangee(C.vendus, "Ventes sûres", fmtN(f.surs)) + rangee(C.dep, "Probables", fmtN(f.probables)) + rangee(C.dep, "Possibles", fmtN(f.possibles))
          + rangee(null, "Fourchette", `${fmtN(f.surs)} à ${fmtN(f.surs + f.probables + f.possibles)}`) + rangee(null, "Valeur centrale", fmtN(f.surs + f.probables)) + (f.exclus != null ? rangee(null, "Sorties sans vente", fmtN(f.exclus)) : "")
          : rangee(C.neutre, "Vendus, sans fourchette", fmtN(l ? l.vendus : 0))) + noteJour(jours[i]); } }));
    }
    const pr = doc.profondeur && Array.isArray(doc.profondeur.niveaux) && doc.profondeur.niveaux.length ? doc.profondeur : null;
    if (pr) {
      const nv = pr.niveaux.filter((x) => Array.isArray(x) && nb(x[0]) && nb(x[1])), maxq = Math.max(1, ...nv.map((x) => x[1])), somme = nv.reduce((a, x) => a + x[1], 0);
      const total = nb(pr.total) ? pr.total : somme + (pr.reste || 0), ic = c ? nv.findIndex((x) => x[0] > c.prix) : -1, ligneC = c ? `<li class="conseil"><span class="pp">${pieces(c.prix)}</span><span class="trait">prix conseillé</span></li>` : "";
      let cumul = 0;
      cartes.push(`<section class="carte" aria-labelledby="t-prof"><div class="carte-tete"><h3 id="t-prof">Profondeur du marché</h3>${aide("profondeur")}</div>
        <p class="carte-sous">${fmtN(total)} unité${total > 1 ? "s" : ""} en vente au dernier relevé, de la moins chère à la plus chère</p>
        <ul class="prof">${nv.map(([px, q], i) => { cumul += q; return (i === ic ? ligneC : "") + `<li tabindex="0" data-bulle="${esc(JSON.stringify({ p: px, q, cumul }))}"><span class="pp">${pieces(px)}</span><span class="pb"><i style="width:${(100 * q / maxq).toFixed(1)}%"></i></span><span class="pq">${fmtN(q)}</span></li>`; }).join("")}
          ${c && ic < 0 ? ligneC : ""}${pr.reste > 0 ? `<li class="reste">et ${fmtN(pr.reste)} unité${pr.reste > 1 ? "s" : ""} plus chère${pr.reste > 1 ? "s" : ""}</li>` : ""}</ul></section>`);
    }
    const ph = Array.isArray(doc.profil_heures) && doc.profil_heures.length === 24 && doc.profil_heures.some((x) => x > 0) ? doc.profil_heures.map((x) => Number(x) || 0) : null;
    if (ph) {
      const best = new Set(heuresOk || []), totalH = ph.reduce((a, x) => a + x, 0), pic = ph.indexOf(Math.max(...ph)), coul = (i) => !best.size || best.has(i) ? C.vendus : C.dep;
      cartes.push(`<section class="carte" aria-labelledby="t-heures"><div class="carte-tete"><h3 id="t-heures">Ventes par heure du jour</h3>${aide("heures")}</div>
        ${best.size ? `<div class="legende"><span><span class="cle rect" style="background:${C.vendus}"></span>meilleures heures</span><span><span class="cle rect" style="background:${C.dep}"></span>autres heures</span></div>` : '<p class="carte-sous">Unités vendues par heure de Paris, sur 7 jours</p>'}
        <div class="graphique" id="g-heures"></div>
        <details class="tableau-vue"><summary>Les mêmes données en tableau</summary><div class="tv-cadre"><table class="tv"><thead><tr><th scope="col">Heure de Paris</th><th scope="col">Vendus en 7 jours</th><th scope="col">Part</th></tr></thead><tbody>
          ${ph.map((x, i) => `<tr><td>${i} h à ${(i + 1) % 24} h${best.has(i) ? " *" : ""}</td><td>${fmtN(x, 1)}</td><td>${pctTxt(x / totalH)}</td></tr>`).join("")}</tbody></table></div>${best.size ? '<p class="petit">* meilleures heures pour vendre</p>' : ""}</details></section>`);
      apres.push(() => barres($("#g-heures"), { n: 24, H: 176, titre: "Unités vendues par heure du jour, heure de Paris, sur 7 jours.", piles: (i) => [{ v: ph[i], c: coul(i) }],
        nomme: (i, slot) => i % (slot * 3 >= 30 ? 3 : 6) === 0 ? i + " h" : null, etiquette: (i) => i === pic ? `${fmtN(ph[i])} à ${i} h` : null,
        bulle: (i) => `<div class="t">De ${i} h à ${(i + 1) % 24} h, heure de Paris</div>` + rangee(coul(i), "Vendus en 7 jours", fmtN(ph[i], 1)) + rangee(null, "Part des ventes", pctTxt(ph[i] / totalH)) }));
    }
    const pal = Array.isArray(doc.paliers) ? doc.paliers.filter((x) => x && x.palier != null && nb(x.n)) : [];
    if (pal.length) cartes.push(`<section class="carte" aria-labelledby="t-pal"><div class="carte-tete"><h3 id="t-pal">À quel prix ça part</h3>${aide("paliers")}</div>
      <div class="tv-cadre"><table class="tv pal"><thead><tr><th scope="col">Prix de l'annonce</th><th scope="col">Posées</th><th scope="col">Vendues</th><th scope="col">En 1 h</th><th scope="col">Perdues</th><th scope="col">En vente</th></tr></thead><tbody>
        ${pal.map((x) => `<tr><td>${esc(x.palier)}</td><td>${fmtN(x.n)}</td><td><b>${fmtN(x.vendu)}</b>${x.n > 0 && nb(x.vendu) ? ` <span class="nd">(${pctTxt(x.vendu / x.n)})</span>` : ""}</td><td>${fmtN(x.vendu_1h)}</td><td>${fmtN(x.perdu)}</td><td>${fmtN(x.encore)}</td></tr>`).join("")}</tbody></table></div></section>`);
    const comp = doc.composant_de || [];
    if (fab.length || comp.length) {
      const avec = comp.map((r) => ({ r, pr: r[3] ? D.parId.get(r[3]) : null })), vus = avec.filter((x) => x.pr).sort((a, b) => (b.pr.vj || 0) - (a.pr.vj || 0)), sans = avec.filter((x) => !x.pr);
      const li = ({ r, pr }) => `<li><div><a class="nom ${qcl(pr.qual)}" href="#/recette/${r[0]}">${esc(pr.nom)}</a><span class="en">${esc(r[2] || "recette " + r[0])} · ${esc(metierFr(r[1]))}</span></div><div class="r-d">${nb(pr.mv7) ? pieces(pr.mv7) : '<span class="nd">pas de vente</span>'}<span class="en">${fmtQ(pr.vj)} vendus par jour</span></div></li>`;
      cartes.push(`<section class="carte" aria-labelledby="t-rec"><div class="carte-tete"><h3 id="t-rec">Recettes liées</h3>${aide("recettes")}</div>
        ${fab.length ? `<h4>Fabriqué par</h4><ul class="recettes">${fab.map((r) => `<li><div><span class="nom-l"><a class="nom" href="#/recette/${r[0]}">${esc(r[2] || "recette " + r[0])}</a>${etqCamp(r[5], r[1], r[6], campsDoc[r[7]])}</span><span class="en">${esc(metierFr(r[1]))}${r[3] ? ", niveau " + fmtN(r[3]) : ""}${r[4] && r[4] !== 1 ? `, ${fmtN(r[4], 2)} par fabrication` : ""}</span></div></li>`).join("")}</ul>` : ""}
        ${comp.length ? `<h4>Entre dans ${fmtN(comp.length)} recette${comp.length > 1 ? "s" : ""}</h4><ul class="recettes">${vus.slice(0, 8).map(li).join("")}</ul>
          ${vus.length > 8 ? `<details class="suite"><summary>Les ${fmtN(vus.length - 8)} autres</summary><ul class="recettes">${vus.slice(8).map(li).join("")}</ul></details>` : ""}
          ${sans.length ? `<ul class="recettes"><li><span class="autres">${vus.length ? "Aussi, sans" : "Sans"} produit vu à l'hôtel des ventes : ${sans.map(({ r }) => `<a href="#/recette/${r[0]}">${esc(r[2] || "recette " + r[0])}</a> (${esc(metierFr(r[1]))})`).join(", ")}.</span></li></ul>` : ""}` : ""}</section>`);
    }
    const fait = (k, v, sec) => `<div><dt>${k}</dt><dd>${v}${sec ? `<span class="sec">${sec}</span>` : ""}</dd></div>`;
    cartes.push(`<section class="carte" aria-labelledby="t-chiffres"><div class="carte-tete"><h3 id="t-chiffres">Les chiffres des 7 jours</h3>${aide("ecoulement", "Écoulement et heures de stock")}</div>
      <dl class="faits">${fait(fmoy && fmoy.hi > 0 ? "Vendus par jour, compte d'origine" : "Vendus par jour", fmtQ(o.vj))}${fait("Or vendu par jour", montant(o.valj), `${prixTexte(val7)} sur la fenêtre`)}
        ${fait("Médiane vendue", pieces(o.mv7))}${fait("Dernier jour vendu", pieces(o.mv1), nb(o.tend) ? `${variation(o.tend)} contre la médiane des 7 jours` : "")}
        ${fait("Plancher du dernier jour", pieces(o.pl), `relevés du ${esc(dateFr(o.dernier, true))}`)}${fait("Déposés par jour", fmtQ(o.dep), `${fmtN(dep7)} sur la fenêtre`)}
        ${fait("Écoulement", pctTxt(o.taux))}${fait("Heures de stock", heuresTxt(hsUtile(o)), `${fmtN(stockFin)} en vente en fin de journée`)}
        ${fait("En vente au dernier relevé", fmtN(o.st))}${fait("Expirés pour 100 vendus", v7 ? fmtN(100 * ex7 / v7) : VIDE, `${fmtN(ex7)} unités expirées`)}
        ${fait(`Depuis le ${esc(dateFr(o.premier, true))}`, `${fmtN(o.vtot)} vendus`, prixTexte(o.valtot))}</dl></section>`);
    const sorties = serie.some((l) => l && ventes(l).f && ventes(l).f.exclus != null);
    vue.innerHTML = `${enteteObjet(o)}<p class="o-sous">${sous}</p>${avisFav}${avisC}${blocPlan}${verdict}${blocCout}${blocFab}${blocVP}
      <div class="g-tete"><h2>Prix et volumes par jour ${aide("pv")}</h2>
        <div class="segments" role="group" aria-label="Fenêtre de temps">${FEN.filter(([k]) => k !== "90" || fenetre === "90" || tous.length > 30).map(([k, v]) => `<button type="button" id="o-f-${k}" data-fenetre="${k}" class="${k === fenetre ? "actif" : ""}" aria-pressed="${k === fenetre}">${v}</button>`).join("")}</div></div>
      <div class="carte">
        <div class="legende"><span><span class="cle" style="border-color:${C.med}"></span>médiane vendue</span><span><span class="cle" style="border-color:${C.pl}"></span>plancher</span><span><span class="cle rect" style="background:${C.dep}"></span>déposés</span><span><span class="cle rect" style="background:${C.vendus}"></span>vendus</span>${jours.some((j) => { const x = journee(j); return x && !x.complet; }) ? '<span><span class="cle rect" style="background:var(--bg-3)"></span>collecte incomplète ou en cours</span>' : ""}</div>
        <div class="graphique" id="g-pv"></div>
        ${fenetre !== "tout" && Number(fenetre) > tous.length ? `<p class="petit">La collecte de cet objet commence le ${esc(dateFr(premier))} : ${fmtN(tous.length)} jour${tous.length > 1 ? "s" : ""} disponible${tous.length > 1 ? "s" : ""}.</p>` : ""}
        <details class="tableau-vue"><summary>Les mêmes données en tableau</summary><div class="tv-cadre"><table class="tv large"><thead><tr>${["Jour", "Déposés", "Vendus", "Écoulement", "Or vendu", "Médiane vendue", "Plancher", "Premier quartile", "Médiane des annonces", "En vente", "En fin de journée", "Annonces", "Expirés", "Retraits", "Incertains", ...(sorties ? ["Sorties sans vente"] : []), "Relevés", "Heures"].map((t) => `<th scope="col">${t}</th>`).join("")}</tr></thead><tbody>
          ${serie.map((l, i) => [l, jours[i]]).reverse().filter(([l]) => l).map(([l, j]) => { const x = ventes(l), jj = journee(j); return `<tr class="${jj && !jj.complet ? "gris" : ""}"><td>${dateCourt(j)}${jj && !jj.complet ? " *" : ""}</td><td>${fmtN(l.deposes)}</td><td>${ventesTxt(l)}</td><td>${l.deposes >= 20 ? pctTxt(x.v / l.deposes) : VIDE}</td><td>${montant(l.valeur)}</td><td>${l.vendus ? pieces(l.med_vendu) : VIDE}</td><td>${pieces(l.plancher)}</td><td>${pieces(l.p25)}</td><td>${pieces(l.med_annonces)}</td><td>${fmtN(l.stock)}</td><td>${fmtN(l.stock_fin)}</td><td>${fmtN(l.annonces)}</td><td>${fmtN(l.expires)}</td><td>${fmtN(l.retraits)}</td><td>${fmtN(l.incertains)}</td>${sorties ? `<td>${x.f ? fmtN(x.f.exclus) : VIDE}</td>` : ""}<td>${fmtN(l.releves)}</td><td>${heuresTxt(jj && jj.heures)}</td></tr>`; }).join("")}</tbody></table></div>
          <p class="petit">* collecte incomplète ou journée en cours</p></details>
      </div>
      <div class="grille-2">${cartes.join("")}</div>`;
    majEpingles();
    $$("[data-fenetre]", vue).forEach((b) => b.addEventListener("click", () => majHash({ fenetre: b.dataset.fenetre })));
    graphiquePanneaux($("#g-pv"), { jours, titre: `Prix et volumes par jour de ${o.nom}.`, vide: "Aucun relevé sur cette fenêtre.",
      haut: { titre: "Prix", lignes: [{ couleur: C.pl, valeurs: serie.map((l) => l ? l.plancher : null) }, { couleur: C.med, valeurs: serie.map((l) => l && l.vendus ? l.med_vendu : null) }] },
      bas: { titre: "Volumes, en unités", barres: [{ couleur: C.dep, valeurs: serie.map((l) => l ? (l.deposes || 0) : 0) }, { couleur: C.vendus, valeurs: serie.map((l) => ventes(l).v) }] },
      bande: (i) => { const j = journee(jours[i]); return j && !j.complet; },
      moustache: (i) => { const x = ventes(serie[i]); return x.f && x.hi > x.lo ? [x.lo, x.hi] : null; },
      bulle: (i) => {
        const l = serie[i];
        if (!l) return `<div class="t">${esc(dateFr(jours[i]))}</div>` + rangee(null, "Relevés", "aucun") + noteJour(jours[i]);
        const x = ventes(l);
        return `<div class="t">${esc(dateFr(jours[i]))}</div>` + rangee(C.med, "Médiane vendue", l.vendus && nb(l.med_vendu) ? pieces(l.med_vendu) : "aucune vente") + rangee(C.pl, "Plancher", pieces(l.plancher))
          + rangee(C.dep, "Déposés", fmtN(l.deposes)) + rangee(C.vendus, "Vendus", ventesTxt(l)) + (x.f && x.f.exclus != null ? rangee(null, "Sorties sans vente", fmtN(x.f.exclus)) : "")
          + rangee(null, "Écoulement", l.deposes >= 20 ? pctTxt(x.v / l.deposes) : VIDE) + rangee(null, "Or vendu", montant(l.valeur)) + rangee(null, "Expirés", fmtN(l.expires)) + noteJour(jours[i]);
      } });
    apres.forEach((f) => f());
  }

  // --------------------------------------------------------------------- artisanat
  /* Filtre de métier : « mes » (les métiers mémorisés), « tous », un identifiant, ou plusieurs séparés par un tiret (164-186).
     Sans paramètre, mes métiers s'ils existent. `ids` : les métiers retenus, vide quand tous le sont. */
  function choixMetier(param, presents) {
    const mes = mesMetiers.filter((m) => presents.has(m));
    const choix = param === "tous" ? "" : param === "mes" || !param ? (mes.length ? "mes" : "") : param;
    const ids = choix === "mes" ? mes : choix ? [...new Set(choix.split(/[-,]/))].filter((m) => presents.has(m)) : [];
    return { mes, choix, ids, garde: (m) => !choix || ids.includes(String(m)) };
  }
  /* Vue d'ensemble de l'artisanat, sur téléphone : repliée sur les métiers choisis, dépliée à la demande. */
  let vgDeplie = false;
  const optionsMetier = (liste, cm) => (cm.mes.length ? `<option value="mes"${cm.choix === "mes" ? " selected" : ""}>Mes métiers (${esc(cm.mes.map(metierFr).join(", "))})</option>` : "")
    + `<option value="${cm.mes.length ? "tous" : ""}"${cm.choix === "" ? " selected" : ""}>Tous</option>` + liste.map(([k, v]) => `<option value="${esc(k)}"${k === cm.choix ? " selected" : ""}>${esc(v)}</option>`).join("");
  /* Raison d'une recette non chiffrable, en clair. */
  const RAISONS = { jamais_vu: "produit jamais vu à l'hôtel des ventes", sans_vente: "aucune vente du produit en 7 jours", composant: "composant sans prix", sans_annonce: "aucune annonce du produit en ce moment" };
  const ETATS = [["rentable", "Rentables"], ["perte", "À perte"], ["nc", "Non chiffrables"], ["toutes", "Toutes"]];
  const etqFragile = (x) => x.fragile ? `<span class="etq-f" title="${x.marge7 > 0 ? "Rentable à la médiane vendue des 7 jours, à perte au plancher du moment" : "À perte à la médiane vendue des 7 jours, rentable au plancher du moment"}">fragile</span>` : "";
  /* Revente « au plancher du moment » plafonnée (25/11/2026, fiche du Chaperon terrestre en soie) : quand le plancher dépasse
     plancher_max fois la médiane vendue des 7 jours, la marge « au plancher du moment » est calculée à ce plafond et non au
     plancher affiché. La fiche d'un objet et la page de sa recette le disent, comme l'étiquette « plafonné » de l'artisanat. */
  const estPlafonne = (a) => !!a && nb(a.revente_instant) && nb(a.plancher_instant) && a.revente_instant < a.plancher_instant;
  const mentionPlafond = (a, max) => estPlafonne(a) ? ` <span class="etq-f" title="Le plancher du moment dépasse ${fmtN(max ?? 1.5, 1)} fois la médiane vendue des 7 jours : la revente retenue est plafonnée à ce niveau">plafonné</span> <span class="nd">(revente comptée ${prixTexte(a.revente_instant)}, et non le plancher de ${prixTexte(a.plancher_instant)})</span>` : "";
  async function vueArtisanat(p, vivant) {
    const vue = $("#vue");
    titre("Artisanat");
    vue.innerHTML = '<div class="titre-page"><h1>Ce qui est rentable à fabriquer</h1></div><p class="attente">Chargement…</p>';
    const doc = avecRemise(await charger("data/artisanat.json"));
    if (!vivant()) return;
    /* Deux lectures de la revente : la médiane vendue des 7 jours (la référence) ou le plancher du moment, l'annonce la moins
       chère au dernier relevé. Une recette non chiffrable sur 7 jours le reste au plancher du moment : sans vente connue,
       une annonce ne dit pas que le produit se vend. */
    const moment = p.get("prix") === "moment";
    const Ltout = tab(doc.colonnes, doc.lignes).map((r) => {
      const nc7 = r.etat === "non_chiffrable", marge7 = nc7 || !nb(r.marge) ? null : r.marge;
      let marge = marge7, raison = r.raison || null;
      if (moment && !nc7) { marge = nb(r.marge_instant) ? r.marge_instant : null; if (marge == null) raison = "sans_annonce"; }
      const etat = marge == null ? "nc" : marge > 0 ? "rentable" : "perte", ecoul = r.ecoulable_j || 0, vj = r.vendus_j || 0;
      return { spell: r.spell, metier: String(r.metier), nom: r.nom_en || "recette " + r.spell, niv: r.niveau, pid: r.produit, pnom: r.produit_nom, qp: r.qp, cout: r.cout,
        mv7: r.med_vendu_7j, plI: r.plancher_instant, revI: r.revente_instant, stI: r.stock_instant, marge7, marge, etat, raison, net: marge != null && nb(r.cout) ? r.cout + marge : null,
        renta: marge != null && r.cout > 0 ? marge / r.cout : null, vj, ecoul, rh: r.recharge_h ?? null, taux: r.taux_produit ?? null, fragile: !!r.fragile,
        gain: marge == null ? null : moment ? Math.round(marge * ecoul) : (r.gain_j || 0), marche: marge == null ? null : moment ? Math.round(marge * vj) : (r.marche_j || 0),
        manque: (r.composants || []).filter((c) => c[2] == null).map((c) => c[0]), k: norm(r.nom_en) + " | " + norm(r.produit_nom),
        camp: r.camp ?? null, lien: r.lien ?? null, plan: r.plan ?? null, fav: r.faveur ?? null };
    });
    /* Camp : les recettes dont le plan est réservé à l'autre camp restent dans la liste, grisées, sauf si le lecteur les masque. */
    const campsArt = doc.camps || {}, autreCamp = monCamp === "horde" ? "alliance" : monCamp === "alliance" ? "horde" : null;
    /* Plans en Faveur de marchand : la liste peut se réduire aux recettes dont le plan s'achète en Faveur (la page #/faveur les détaille). */
    const favSeul = p.get("faveur") === "1", Lcamp = masquerAutreCamp ? Ltout.filter((x) => !horsCamp(x.camp)) : Ltout;
    const L = favSeul ? Lcamp.filter((x) => nb(x.fav)) : Lcamp;
    const metiers = Object.entries(D.meta.metiers || {}).map(([k, v]) => [k, v.fr]).filter(([k]) => L.some((x) => x.metier === k)).sort((a, b) => a[1].localeCompare(b[1], "fr"));
    const presents = new Set(L.map((x) => x.metier)), cm = choixMetier(p.get("metier") || "", presents);
    /* Métiers retenus (aucun : tous). Un paramètre qui ne désigne aucun métier connu vaut « tous ». */
    const S = cm.ids, gardeM = (m) => !S.length || S.includes(String(m));
    const memeChoix = (a, b) => a.length === b.length && a.every((m) => b.includes(m));
    const versHash = (ids) => { const t = [...ids].sort((a, b) => a - b); return !t.length ? (cm.mes.length ? "tous" : "") : memeChoix(t, cm.mes) ? "" : t.join("-"); };
    const TR = [["gain", "Gain par jour d'un vendeur"], ["renta", "Rentabilité (marge sur coût)"], ["marche", "Taille du marché"], ["marge", "Marge par pièce"], ["vj", "Ventes du produit"], ["taux", "Écoulement du produit"], ["niveau", "Niveau requis"]];
    const tri = TR.some(([k]) => k === p.get("tri")) ? p.get("tri") : "gain", nivMax = p.get("niveau") || "";
    const etat = ETATS.some(([k]) => k === p.get("etat")) ? p.get("etat") : p.get("tous") === "1" ? "toutes" : "rentable";
    vue.innerHTML = `
      <div class="titre-page"><h1>Ce qui est rentable à fabriquer</h1>${aide("artisanat")}<p class="sous">Prix des composants du ${esc(dateFr(doc.jour, true))}${doc.remise ? `, remise de ${doc.remise}${NBSP}% chez les marchands` : ""}, commission de ${fmtN(100 * doc.commission)}${NBSP}% déduite, revente ${moment ? "au plancher du moment" : "à la médiane vendue des 7 jours"}</p></div>
      <section class="carte vg"><div class="vg-tete"><h2>Vue d'ensemble ${aide("vueGlobale")}</h2>
        <div class="vg-leg"><span><i class="vr"></i>rentables</span><span><i class="vp"></i>à perte</span><span><i class="vn"></i>non chiffrables</span></div></div>
        <p class="vg-consigne">Choisissez un ou plusieurs métiers pour ne voir que leurs recettes.</p>
        <div class="vg-lignes" id="a-vg"></div>
        <div class="vg-pied" id="a-vg-pied"></div></section>
      <div class="barre">
        <label class="champ"><span>Niveau au plus</span><input type="number" id="a-niv" min="1" max="300" step="5" value="${esc(nivMax)}" placeholder="300"></label>
        <label class="champ"><span>Tri</span><select id="a-tri">${TR.map(([k, v]) => `<option value="${k}"${k === tri ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="champ large"><span>Filtrer</span><input type="search" id="a-q" value="${esc(p.get("q") || "")}" placeholder="recette ou produit"></label>
      </div>
      <div class="barre">
        <div class="puces serre" role="group" aria-label="État des recettes" id="a-etats"></div>
        <div class="puces serre" role="group" aria-label="Prix de revente"><span class="puces-l">Revente ${aide("lecture")}</span>
          <button type="button" class="puce" data-prix="" aria-pressed="${!moment}">médiane vendue 7 j</button><button type="button" class="puce" data-prix="moment" aria-pressed="${moment}">plancher du moment</button></div>
        <div class="puces serre" role="group" aria-label="Recettes accessibles à"><span class="puces-l">Mon camp ${aide("camp")}</span>
          ${[["horde", "Horde"], ["alliance", "Alliance"], ["tous", "les deux"]].map(([k, v]) => `<button type="button" class="puce" data-camp="${k}" aria-pressed="${k === monCamp}">${v}</button>`).join("")}
          ${autreCamp ? `<button type="button" class="puce" id="a-masque" aria-pressed="${masquerAutreCamp}" title="Masquer les recettes dont le plan n'est accessible qu'à ${CAMPS_DE[autreCamp]}">masquer les plans ${CAMPS[autreCamp]} <span class="puce-n" id="a-nhors"></span></button>` : ""}</div>
        <div class="puces serre" role="group" aria-label="Votre remise chez les marchands"><span class="puces-l">Ma remise chez les marchands ${aide("remise")}</span>
          ${REMISES.map((k) => `<button type="button" class="puce" data-remise="${k}" aria-pressed="${k === maRemise}">${k}${NBSP}%</button>`).join("")}</div>
        <div class="puces serre" role="group" aria-label="Plans en Faveur de marchand"><button type="button" class="puce" id="a-fav" aria-pressed="${favSeul}" title="Ne garder que les recettes dont le plan s'achète en Faveur de marchand, la monnaie des caisses détournées">plans en Faveur <span class="puce-n">${fmtN(Lcamp.filter((x) => nb(x.fav)).length)}</span></button><a class="fv-lien" href="#/faveur">ce que la Faveur achète</a></div>
        <span class="compte" id="a-compte" role="status"></span>
      </div>
      <div class="liste-cadre"><table class="liste art">${entetes([{ t: "Recette" }, { t: "Coût et revente", tri: "renta", aide: "coutRevente" }, { t: "Marge nette", num: true, tri: "marge" }, { t: "Demande", tri: "vj", aide: "ecoulement" }, { t: "Gain par jour", num: true, tri: "gain" }], tri)}<tbody id="a-corps"></tbody></table></div>
      <div class="centre" id="a-plus"></div>`;
    $("#a-tri").addEventListener("change", (e) => majHash({ tri: e.target.value }));
    $("#a-niv").addEventListener("change", (e) => majHash({ niveau: e.target.value }));
    vue.querySelectorAll("[data-prix]").forEach((b) => b.addEventListener("click", () => majHash({ prix: b.dataset.prix })));
    vue.querySelectorAll("[data-camp]").forEach((b) => b.addEventListener("click", () => { monCamp = b.dataset.camp; noterCamp(); router(); }));
    if ($("#a-masque")) $("#a-masque").addEventListener("click", () => { masquerAutreCamp = !masquerAutreCamp; noterCamp(); router(); });
    $("#a-fav").addEventListener("click", () => majHash({ faveur: favSeul ? "" : "1" }));
    D.surTri = (t) => majHash({ tri: t });
    let filtre = p.get("q") || "", limite = 200;
    /* Comparaisons qui rangent les recettes non chiffrables (valeur absente) après toutes les autres. */
    const desc = (k) => (a, b) => ((b[k] ?? -1e18) - (a[k] ?? -1e18)) || ((b.gain ?? -1e18) - (a.gain ?? -1e18)) || ((a.niv || 999) - (b.niv || 999));
    const cmp = { gain: desc("gain"), renta: desc("renta"), marche: desc("marche"), marge: desc("marge"), vj: desc("vj"), taux: desc("taux"),
      niveau: (a, b) => ((a.niv || 999) - (b.niv || 999)) || ((b.gain ?? -1e18) - (a.gain ?? -1e18)) }[tri];
    const nm = Number(nivMax) || 0, auNiveau = L.filter((x) => !nm || (x.niv || 0) <= nm);
    /* Vue d'ensemble : une barre par métier, à la même échelle (le métier qui a le plus de recettes fait toute la largeur). */
    const parMetier = metiers.map(([k, v]) => { const l = auNiveau.filter((x) => x.metier === k); return { k, v, r: l.filter((x) => x.etat === "rentable").length, p: l.filter((x) => x.etat === "perte").length, n: l.filter((x) => x.etat === "nc").length }; })
      .filter((m) => m.r + m.p + m.n).sort((a, b) => (b.r - a.r) || (b.p - a.p));
    const maxM = Math.max(1, ...parMetier.map((m) => m.r + m.p + m.n)), pc = (n) => n ? Math.max(1.2, 100 * n / maxM).toFixed(2) : 0;
    $("#a-vg").style.setProperty("--vg-r", Math.ceil(parMetier.length / 2));
    $("#a-vg").innerHTML = parMetier.map((m) => {
      const actif = S.includes(m.k);
      return `<button type="button" class="vg-l${actif ? " actif" : ""}" data-metier="${esc(m.k)}" aria-pressed="${actif}" title="${esc(m.v)} : ${fmtN(m.r)} rentables, ${fmtN(m.p)} à perte, ${fmtN(m.n)} non chiffrables">
        <span class="vg-n">${esc(m.v)}</span><span class="vg-b">${m.r ? `<i class="vr" style="width:${pc(m.r)}%"></i>` : ""}${m.p ? `<i class="vp" style="width:${pc(m.p)}%"></i>` : ""}${m.n ? `<i class="vn" style="width:${pc(m.n)}%"></i>` : ""}</span>
        <span class="vg-c"><b>${fmtN(m.r)}</b>${NBSP}rentables<span class="pp"> · ${fmtN(m.p)} à perte · ${fmtN(m.n)} non chiffrables</span></span></button>`;
    }).join("") || '<p class="rien">Aucune recette à ce niveau.</p>';
    $("#a-vg").querySelectorAll("[data-metier]").forEach((b) => b.addEventListener("click", () => {
      const s = new Set(S); if (s.has(b.dataset.metier)) s.delete(b.dataset.metier); else s.add(b.dataset.metier);
      majHash({ metier: versHash(s) });
    }));
    /* Pied de la carte : tout afficher, revenir à ses métiers, mémoriser le choix ; sur téléphone, déplier la liste repliée. */
    const carteVg = $("#a-vg").closest(".vg"), nomsMes = cm.mes.map(metierFr).sort((a, b) => a.localeCompare(b, "fr")).join(", "), estMes = S.length > 0 && memeChoix(S, cm.mes);
    const replier = () => carteVg.classList.toggle("replie", S.length > 0 && !vgDeplie);
    replier();
    $("#a-vg-pied").innerHTML = (S.length ? `<button type="button" class="puce vg-plus" id="a-deplier" aria-expanded="${vgDeplie}">${vgDeplie ? "Replier la liste" : "Ajouter ou changer de métier"}</button>` : "")
      + (S.length ? `<button type="button" class="puce" id="a-tous">Tous les métiers</button>` : "")
      + (cm.mes.length && !estMes ? `<button type="button" class="puce" id="a-mes" title="Revenir à vos métiers mémorisés">Mes métiers (${esc(nomsMes)})</button>` : "")
      + (S.length && !estMes ? `<button type="button" class="puce" id="a-memo" title="Ce choix sera appliqué d'office à l'ouverture d'Artisanat et de Farm. Il reste dans ce navigateur : rien n'est envoyé.">Mémoriser comme mes métiers</button>` : "")
      + (estMes ? `<span class="vg-etat">Vos métiers mémorisés sont appliqués.</span>` : "");
    if ($("#a-deplier")) $("#a-deplier").addEventListener("click", (e) => { vgDeplie = !vgDeplie; replier(); e.currentTarget.setAttribute("aria-expanded", vgDeplie); e.currentTarget.textContent = vgDeplie ? "Replier la liste" : "Ajouter ou changer de métier"; });
    if ($("#a-tous")) $("#a-tous").addEventListener("click", () => majHash({ metier: cm.mes.length ? "tous" : "" }));
    if ($("#a-mes")) $("#a-mes").addEventListener("click", () => majHash({ metier: "" }));
    if ($("#a-memo")) $("#a-memo").addEventListener("click", () => {
      mesMetiers = [...mesMetiers.filter((m) => !presents.has(m)), ...S]; boite.ecrire("hv-metiers", mesMetiers);
      if (p.get("metier")) majHash({ metier: "" }); else router();
    });
    /* Puces d'état : les comptes sont ceux de la sélection (métier, niveau), avant le filtre de texte. */
    const duMetier = auNiveau.filter((x) => gardeM(x.metier)), nEtat = (e) => e === "toutes" ? duMetier.length : duMetier.filter((x) => x.etat === e).length;
    if ($("#a-nhors")) $("#a-nhors").textContent = fmtN(Ltout.filter((x) => horsCamp(x.camp) && (!nm || (x.niv || 0) <= nm) && gardeM(x.metier)).length);
    $("#a-etats").innerHTML = ETATS.map(([k, v]) => `<button type="button" class="puce" data-etat="${k}" aria-pressed="${k === etat}">${v} <span class="puce-n">${fmtN(nEtat(k))}</span></button>`).join("");
    $("#a-etats").querySelectorAll("[data-etat]").forEach((b) => b.addEventListener("click", () => majHash({ etat: b.dataset.etat === "rentable" ? "" : b.dataset.etat, tous: "" })));
    const nomObjet = (i) => { const o = D.parId.get(i); return o ? o.nom : "objet " + i; };
    const rendre = () => {
      const fq = norm(filtre.trim());
      let sel = duMetier.filter((x) => (etat === "toutes" || x.etat === etat) && (!fq || x.k.includes(fq)));
      sel.sort(cmp);
      const total = sel.length, nHors = sel.filter((x) => horsCamp(x.camp)).length; sel = sel.slice(0, limite);
      $("#a-corps").innerHTML = sel.map((x) => {
        const hc = horsCamp(x.camp) ? " hc" : "";
        const pr = D.parId.get(x.pid), plaf = moment && x.etat !== "nc" && nb(x.revI) && nb(x.plI) && x.revI < x.plI;
        const tete = `<td class="c-objet"><div class="obj"><div><div class="nom-l"><a class="nom ${qcl(pr && pr.qual)}" href="#/recette/${x.spell}">${esc(x.pnom || x.nom)}</a>${etqCamp(x.camp, x.metier, x.lien, campsArt[x.plan])}${etqFaveur(x.fav)}${etqRecharge(x.rh)}${etqFragile(x)}${plaf ? `<span class="etq-f" title="Le plancher du moment dépasse ${fmtN(doc.plancher_max ?? 1.5, 1)} fois la médiane vendue des 7 jours : la revente retenue est plafonnée à ce niveau">plafonné</span>` : ""}</div><span class="en">${esc(x.nom)}${x.qp !== 1 ? ` · ${fmtN(x.qp, 2)} par fabrication` : ""} · ${esc(metierFr(x.metier))}${x.niv ? " " + fmtN(x.niv) : ""}</span></div></div></td>`;
        const demande = x.vj > 0 ? `<div class="dem"><b>${fmtQ(x.vj)}</b><span>${NBSP}par jour</span></div>${jauge(x.taux)}` : `<span class="nd">${VIDE}</span>`;
        if (x.etat === "nc") {
          const raison = x.raison === "composant" ? `composant sans prix : ${x.manque.map(nomObjet).join(", ")}` : RAISONS[x.raison] || "non chiffrable";
          return `<tr data-lien="#/recette/${x.spell}" class="nc${hc}">${tete}
            <td class="c-a"><div class="cr"><span class="cr-l">Coût</span><span class="cr-b">${nb(x.cout) ? '<i class="cr-c" style="width:100%"></i>' : ""}</span><span class="cr-v">${nb(x.cout) ? pieces(x.cout) : '<span class="nd">incomplet</span>'}</span></div>
              <div class="cr"><span class="cr-l">Revente</span><span class="cr-b"></span><span class="cr-v nd">inconnue</span></div></td>
            <td class="c-b"><span class="nc-r">${esc(raison)}</span></td>
            <td class="c-c">${demande}</td>
            <td class="c-tete num"><span class="nd">non chiffrable</span></td></tr>`;
        }
        /* Coût et revente nette à la même échelle : la plus longue des deux barres fait toute la largeur. */
        const ech = Math.max(x.cout || 0, x.net || 0, 1), lc = Math.max(2, Math.round(100 * (x.cout || 0) / ech)), lr = Math.max(2, Math.round(100 * Math.max(0, x.net || 0) / ech));
        const parFab = x.qp !== 1 ? `, ${fmtN(x.qp, 2)} par fabrication` : "";
        const brut = moment ? (nb(x.plI) ? `Annonce la moins chère au dernier relevé : ${prixTexte(x.plI)}${parFab}${nb(x.stI) ? `, ${fmtN(x.stI)} en vente` : ""}${plaf ? ` ; revente retenue : ${prixTexte(x.revI)}, plafonnée à ${fmtN(doc.plancher_max ?? 1.5, 1)} fois la médiane vendue des 7 jours` : ""}, commission déduite` : "")
          : (nb(x.mv7) ? `Médiane vendue des 7 jours : ${prixTexte(x.mv7)}${parFab}, commission déduite` : "");
        return `<tr data-lien="#/recette/${x.spell}" class="${x.marge < 0 ? "negatif" : ""}${hc}">${tete}
          <td class="c-a"><div class="cr" title="Composants d'une fabrication, au prix du jour"><span class="cr-l">Coût</span><span class="cr-b"><i class="cr-c" style="width:${lc}%"></i></span><span class="cr-v">${pieces(x.cout)}</span></div>
            <div class="cr" title="${esc(brut)}"><span class="cr-l">Revente</span><span class="cr-b"><i class="cr-r${x.marge < 0 ? " perte" : ""}" style="width:${lr}%"></i></span><span class="cr-v">${pieces(x.net)}</span></div></td>
          <td class="c-b num" data-m="marge">${pieces(x.marge)}<span class="renta">${variation(x.renta, null, "Rentabilité : marge nette rapportée au coût de fabrication")}</span></td>
          <td class="c-c">${demande}</td>
          <td class="c-tete num">${x.rh === 0 ? '<span class="nd">non chiffré</span><span class="sec">durée de recharge à relever</span>' : `${montant(x.gain)}<span class="u">${NBSP}/j</span>`}${x.rh === 0 ? "" : x.rh >= 20 ? `<span class="sec">${cadenceRecharge(x.rh)}</span>` : nb(x.ecoul) ? `<span class="sec">pour ${fmtN(x.ecoul, 1)} pièces</span>` : ""}</td></tr>`;
      }).join("") || ligneRien("Aucune recette ne correspond.");
      $("#a-compte").textContent = (S.length ? (S.length > 3 ? `${fmtN(S.length)} métiers` : S.map(metierFr).sort((a, b) => a.localeCompare(b, "fr")).join(", ")) + " : " : "") + (total > limite ? `${fmtN(limite)} affichées sur ${fmtN(total)} recettes` : `${fmtN(total)} recette${total > 1 ? "s" : ""}`)
        + (nHors ? `, dont ${fmtN(nHors)} grisée${nHors > 1 ? "s" : ""} : plan réservé à ${CAMPS_DE[autreCamp]}` : "");
      $("#a-plus").innerHTML = total > limite ? `<button type="button" class="bouton" id="a-encore">Afficher la suite (${fmtN(total - limite)} de plus)</button>` : "";
      const b = $("#a-encore"); if (b) b.addEventListener("click", () => { limite += 200; rendre(); });
    };
    rendre();
    $("#a-q").addEventListener("input", (e) => { filtre = e.target.value; limite = 200; noterParam("q", filtre.trim()); rendre(); });
  }

  // ----------------------------------------------------------------------- recette
  async function vueRecette(spell, vivant) {
    const vue = $("#vue"), retour = '<a class="retour" href="#/artisanat">← Artisanat</a>';
    if (!Number.isFinite(spell)) spell = "inconnue";
    titre("Recette");
    vue.innerHTML = `${retour}<div class="titre-page"><h1>Recette ${esc(spell)}</h1></div><p class="attente">Chargement…</p>`;
    const [rec, artBrut, AP] = await Promise.all([charger("data/recettes.json"), charger("data/artisanat.json"), chargerFacultatif("data/apprendre.json")]);
    const art = avecRemise(artBrut);
    if (!vivant()) return;
    const brut = rec.recettes && rec.recettes[String(spell)];
    if (!brut) { vue.innerHTML = `${retour}<div class="titre-page"><h1>Recette ${esc(spell)}</h1></div><p class="attente">Recette inconnue de l'export SkillUp, ou sans produit.</p>`; return; }
    const r = tab(rec.colonnes, [brut])[0], composants = r.composants || [], produit = r.produit || [null, 1], qp = produit[1] || 1, nom = r.nom_en || "recette " + spell;
    const ia = art.colonnes.indexOf("spell"), a = tab(art.colonnes, art.lignes.filter((l) => l[ia] === spell))[0] || null, prod = D.parId.get(produit[0]);
    titre(nom);
    const compInfo = new Map((a ? a.composants || [] : []).filter((x) => x[2] != null).map((x) => [x[0], x]));
    const chiffree = !!a && a.etat !== "non_chiffrable";
    const fragile = chiffree && a.fragile ? etqFragile({ fragile: true, marge7: a.marge }) : "";
    const infoCamp = a && a.plan != null ? (art.camps || {})[a.plan] : null;
    const pourquoi = !a ? "" : a.raison === "jamais_vu" ? "le produit n'a jamais été vu à l'hôtel des ventes depuis le début des relevés" : a.raison === "sans_vente" ? "le produit ne s'est pas vendu sur les 7 derniers jours" : a.raison === "composant" ? "un composant n'a pas de prix" : "le produit ne s'est pas vendu sur les 7 derniers jours ou un composant n'a pas de prix";
    const ids = [produit[0], ...composants.map((x) => x[0])];
    const docs = await Promise.all(ids.map((i) => D.parId.has(i) ? chargerFacultatif(`data/objets/${i}.json`) : Promise.resolve(null)));
    if (!vivant()) return;
    const parObjet = new Map(ids.map((i, k) => [i, docs[k]]));
    const nomDe = (i) => { const o = D.parId.get(i), d = parObjet.get(i); return o ? blocNom(o, esc(o.en)) : `<div>${esc((d && d.nom) || "objet " + i)}</div>`; };
    const commission = art.commission || 0;
    /* Historique de la marge : coût des composants et médiane vendue du produit, jour par jour. */
    const jours = joursFenetre("tout");
    const serieDe = (i) => { const d = parObjet.get(i); return new Map(d ? tab(d.colonnes, d.jours).map((l) => [l.jour, l]) : []); };
    const sProd = serieDe(produit[0]);
    const sComp = composants.map(([i, q]) => ({ q, s: serieDe(i), marchand: compInfo.get(i) && compInfo.get(i)[3] === "marchand" ? compInfo.get(i)[2] : null }));
    const marge = [], cout = [], vendu = [], vol = [];
    for (const j of jours) {
      const lp = sProd.get(j), mv = lp && lp.vendus ? lp.med_vendu : null;
      let cc = 0, ok = true;
      for (const x of sComp) {
        if (x.marchand != null) { cc += x.marchand * x.q; continue; }
        const l = x.s.get(j), pu = l ? ((l.annonces || 0) >= 4 && l.p25 != null ? l.p25 : l.plancher) : null;
        if (pu == null) { ok = false; break; }
        cc += pu * x.q;
      }
      cout.push(ok ? cc : null); vendu.push(mv); vol.push(lp ? (lp.vendus || 0) : 0);
      marge.push(ok && mv != null ? mv * qp * (1 - commission) - cc : null);
    }
    const tuile = (l, v, d) => `<div class="cle-t"><div class="l">${l}</div><div class="v">${v}</div><div class="d"><span>${d}</span></div></div>`;
    vue.innerHTML = `${retour}
      <div class="o-tete"><h1>${esc(nom)}</h1>${a ? etqCamp(a.camp, r.metier, a.lien, infoCamp) : ""}${a ? etqRecharge(a.recharge_h ?? null) : ""}${a ? etqFaveur(a.faveur) : ""}${fragile}</div>
      <p class="o-sous"><b>${esc(metierFr(r.metier))}</b>${r.niveau ? ` · niveau ${fmtN(r.niveau)}` : ""} · donne ${qp !== 1 ? fmtN(qp, 2) + " × " : ""}${prod ? `<a class="nom ${qcl(prod.qual)}" href="#/objet/${prod.id}">${esc(prod.nom)}</a>` : esc("objet " + produit[0])} · <a href="${WHS(spell)}" target="_blank" rel="noopener">Wowhead ↗</a></p>
      ${a ? avisCamp({ camp: a.camp, lien: a.lien, plan: a.plan, metier: r.metier, info: infoCamp }) : ""}
      ${blocApprendre(AP ? cheminsRecette(spell, AP, r.metier, r.niveau) : [])}
      ${chiffree ? `<div class="tuiles">
        ${tuile("Coût des composants", pieces(a.cout), `prix du ${esc(dateFr(art.jour, true))}${art.remise ? `, remise de ${art.remise}${NBSP}% chez les marchands` : ""}`)}
        ${tuile("Produit vendu, médiane 7 j", pieces(a.med_vendu_7j), `dernier jour ${prixTexte(a.med_vendu_dernier)}, plancher ${prixTexte(a.plancher)}`)}
        ${tuile(`Marge nette par fabrication ${aide("artisanat")}`, pieces(a.marge), `après ${fmtN(100 * commission)}${NBSP}% de commission${nb(a.marge_instant) ? ` ; au plancher du moment : ${prixTexte(a.marge_instant)}${estPlafonne(a) ? `, revente plafonnée à ${prixTexte(a.revente_instant)} et non au plancher de ${prixTexte(a.plancher_instant)}` : ""}` : ""}`)}
        ${tuile("Produit vendu par jour", fmtQ(a.vendus_j), a.recharge_h === 0 ? "temps de recharge, durée à relever" : a.recharge_h >= 20 ? `temps de recharge : ${cadenceRecharge(a.recharge_h)}` : `un vendeur en écoule ${fmtN(a.ecoulable_j, 1)}`)}
        ${a.recharge_h === 0 ? tuile("Gain par jour d'un vendeur", '<span class="nd">non chiffré</span>', "durée de la recharge à relever") : tuile("Gain par jour d'un vendeur", montant(a.gain_j), `marché : ${prixTexte(a.marche_j)} par jour`)}</div>`
        : `<p class="avis">Recette non chiffrable aujourd'hui : ${esc(pourquoi)}.${a && nb(a.cout) ? ` Coût des composants : ${prixTexte(a.cout)}.` : ""}</p>`}
      <div class="g-tete"><h2>Composants</h2></div>
      <div class="liste-cadre"><table class="liste">${entetes([{ t: "Composant" }, { t: "Quantité", num: true }, { t: "Prix unitaire", num: true }, { t: "Source" }, { t: "Coût", num: true }])}<tbody>
        ${composants.map(([i, q]) => { const x = compInfo.get(i); return `<tr${D.parId.has(i) ? ` data-lien="#/objet/${i}"` : ""}><td class="c-objet"><div class="obj">${nomDe(i)}</div></td><td class="c-a num" data-m="×">${fmtN(q, 2)}</td><td class="c-b num" data-m="à">${x ? pieces(x[2]) : '<span class="nd">pas de prix</span>'}</td><td class="c-c">${x ? sourceComp(art, i, x[3]) : VIDE}</td><td class="c-tete num">${x ? pieces(x[2] * q) : VIDE}</td></tr>`; }).join("") || ligneRien("Aucun composant connu.")}</tbody></table></div>
      ${a && aMarchand(art, a.composants) ? `<p class="remise-l"><span class="puces-l">Ma remise chez les marchands ${aide("remise")}</span>${choixRemise()}</p>` : ""}
      <div class="g-tete" style="margin-top:18px"><h2>Marge et ventes par jour ${aide("marge")}</h2></div>
      <div class="carte"><div class="graphique" id="g-marge"></div>
        <details class="tableau-vue"><summary>Les mêmes données en tableau</summary><div class="tv-cadre"><table class="tv"><thead><tr><th scope="col">Jour</th><th scope="col">Coût</th><th scope="col">Médiane vendue</th><th scope="col">Marge nette</th><th scope="col">Vendus</th></tr></thead><tbody>
          ${jours.map((j, i) => `<tr><td>${dateCourt(j)}</td><td>${pieces(cout[i])}</td><td>${pieces(vendu[i])}</td><td>${pieces(marge[i])}</td><td>${fmtN(vol[i])}</td></tr>`).reverse().join("")}</tbody></table></div></details></div>`;
    graphiquePanneaux($("#g-marge"), { jours, titre: `Marge nette et ventes par jour de ${nom}.`, vide: "Pas assez de prix pour calculer la marge, et aucune vente du produit.",
      haut: { titre: "Marge nette par fabrication", lignes: [{ couleur: C.med, valeurs: marge }] }, bas: { titre: "Produit vendu, en unités", barres: [{ couleur: C.vendus, valeurs: vol }] },
      bande: (i) => { const j = journee(jours[i]); return j && !j.complet; },
      bulle: (i) => `<div class="t">${esc(dateFr(jours[i]))}</div>` + rangee(C.med, "Marge nette", pieces(marge[i])) + rangee(null, "Coût des composants", pieces(cout[i])) + rangee(null, "Médiane vendue", pieces(vendu[i])) + rangee(C.vendus, "Produit vendu", fmtN(vol[i])) + noteJour(jours[i]) });
  }

  // -------------------------------------------------------------------------- farm
  async function vueFarm(p, vivant) {
    const vue = $("#vue");
    titre("Farm");
    vue.innerHTML = '<div class="titre-page"><h1>Ce qui vaut la peine d\'être farmé</h1></div><p class="attente">Chargement…</p>';
    const doc = await charger("data/farm.json");
    if (!vivant()) return;
    const L = tab(doc.colonnes, doc.lignes).map((r) => ({ o: D.parId.get(r.id), type: r.type, metier: r.metier != null ? String(r.metier) : "", noeud: r.niveau_noeud, vj: r.vendus_j || 0, mv7: r.med_vendu_7j, pl: r.plancher, niv: r.niveau, taux: r.taux ?? null,
      nette: r.valeur_nette ?? Math.round((r.med_vendu_7j || 0) * 0.95), gain: r.gain_j ?? 0 })).filter((x) => x.o);
    const classes = [...new Set(L.map((x) => x.o.classe).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), sx = doc.seuils || {};
    const type = p.get("type") || "", classe = p.get("classe") || "";
    const TR = [["valeur", "Valeur de l'unité"], ["gain", "Gain possible par jour"], ["vj", "Unités par jour"], ["taux", "Écoulement"], ["niv", "Niveau"]];
    const tri = TR.some(([k]) => k === p.get("tri")) ? p.get("tri") : "valeur";
    /* le filtre de métier ne vaut que pour la récolte : il est neutralisé quand une autre source est choisie */
    const metierActif = !type || type === "recolte", cm = choixMetier(metierActif ? (p.get("metier") || "") : "tous", new Set(L.filter((x) => x.type === "recolte").map((x) => x.metier)));
    AIDES.farm[1] = `Ce que vous touchez pour chaque objet récolté, dépecé, pêché ou ramassé, net de la commission de l'hôtel des ventes, sur les 7 derniers jours. Seuls figurent les objets qui se vendent vraiment : au moins ${prixTexte(sx.valeur_min ?? 300)} l'unité, ${fmtN(sx.ventes_jour_min ?? 2)} ventes par jour et ${fmtN(100 * (sx.taux_min ?? 0.2))} % de ce qui est posté qui part. Gain possible par jour : ce qu'un vendeur peut en tirer chaque jour sans casser le prix (${fmtN(doc.plafond_jour ?? 20)} pièces, ou ${fmtN(100 * (doc.part_marche ?? 0.1))} % du marché s'il est plus grand). La chaîne ne connaît ni les zones ni les taux de butin : le lien Wowhead dit où et combien.`;
    vue.innerHTML = `
      <div class="titre-page"><h1>Ce qui vaut la peine d'être farmé</h1>${aide("farm")}<p class="sous">Ce que rapporte chaque objet ramassé, sur 7 jours</p></div>
      <div class="barre">
        <label class="champ"><span>Source</span><select id="r-type"><option value="">Toutes</option>${Object.entries(TYPES_FARM).map(([k, v]) => `<option value="${k}"${k === type ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="champ"><span>Métier de récolte</span><select id="r-metier"${metierActif ? "" : " disabled"}>${optionsMetier([["182", "Herboristerie"], ["186", "Minage"], ["393", "Dépeçage"]], cm)}</select></label>
        <label class="champ"><span>Classe</span><select id="r-classe"><option value="">Toutes</option>${classes.map((x) => `<option value="${esc(x)}"${x === classe ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
        <label class="champ"><span>Tri</span><select id="r-tri">${TR.map(([k, v]) => `<option value="${k}"${k === tri ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="champ large"><span>Filtrer</span><input type="search" id="r-q" value="${esc(p.get("q") || "")}" placeholder="nom français ou anglais"></label>
        <span class="compte" id="r-compte" role="status"></span>
      </div>
      <div class="liste-cadre"><table class="liste">${entetes([{ t: "Objet" }, { t: "Valeur nette", num: true, tri: "valeur" }, { t: "Vendus par jour", num: true, tri: "vj" }, { t: "Écoulement", tri: "taux", aide: "ecoulement" }, { t: "Gain possible par jour", num: true, tri: "gain" }], tri)}<tbody id="r-corps"></tbody></table></div>
      <div class="centre" id="r-plus"></div>`;
    $("#r-type").addEventListener("change", (e) => majHash({ type: e.target.value, metier: !e.target.value || e.target.value === "recolte" ? p.get("metier") : "" }));
    $("#r-metier").addEventListener("change", (e) => { const v = e.target.value; majHash({ metier: v === "mes" ? "" : v, type: v && v !== "mes" && v !== "tous" ? "recolte" : type }); });
    $("#r-classe").addEventListener("change", (e) => majHash({ classe: e.target.value }));
    $("#r-tri").addEventListener("change", (e) => majHash({ tri: e.target.value }));
    D.surTri = (t) => majHash({ tri: t });
    let filtre = p.get("q") || "", limite = 200;
    const sourceTexte = (x) => x.type === "recolte" ? `${metierFr(x.metier)}${x.noeud ? ` ${x.noeud}` : ""}` : x.type === "peche" ? "Pêche" : (TYPES_FARM[x.type] || "");
    const cmp = { valeur: (a, b) => (b.nette || 0) - (a.nette || 0), gain: (a, b) => b.gain - a.gain, vj: (a, b) => b.vj - a.vj,
      taux: (a, b) => ((b.taux ?? -1) - (a.taux ?? -1)) || (b.nette - a.nette), niv: (a, b) => ((b.niv || 0) - (a.niv || 0)) || (b.nette - a.nette) }[tri];
    const rendre = () => {
      const fq = norm(filtre.trim());
      let sel = L.filter((x) => (!type || x.type === type) && (!cm.choix || (x.type === "recolte" && cm.garde(x.metier))) && (!classe || x.o.classe === classe) && (!fq || x.o.k.includes(fq)));
      sel.sort(cmp);
      const total = sel.length; sel = sel.slice(0, limite);
      $("#r-corps").innerHTML = sel.map((x) => `<tr data-lien="#/objet/${x.o.id}">
        <td class="c-objet"><div class="obj">${boutonEpingle(x.o)}${blocNom(x.o, `${esc([x.o.en, sourceTexte(x)].filter(Boolean).join(" · "))}${nb(x.niv) ? ` · objet de niveau ${x.niv}` : ""} · <a href="${WH(x.o.id)}" target="_blank" rel="noopener">Wowhead ↗</a>`)}</div></td>
        <td class="c-tete num">${pieces(x.nette)}${nb(x.pl) ? `<span class="sec">plancher ${pieces(x.pl)}</span>` : ""}</td>
        <td class="c-b num"><b>${fmtQ(x.vj)}</b><span class="u">${NBSP}/j</span></td>
        <td class="c-c">${jauge(x.taux)}</td>
        <td class="c-a num" data-m="gain">${montant(x.gain)}<span class="u">${NBSP}/j</span></td></tr>`).join("") || ligneRien("Rien ne correspond.");
      $("#r-compte").textContent = total > limite ? `${fmtN(limite)} affichés sur ${fmtN(total)} objets` : `${fmtN(total)} objet${total > 1 ? "s" : ""}`;
      $("#r-plus").innerHTML = total > limite ? `<button type="button" class="bouton" id="r-encore">Afficher la suite (${fmtN(total - limite)} de plus)</button>` : "";
      const b = $("#r-encore"); if (b) b.addEventListener("click", () => { limite += 200; rendre(); });
      majEpingles();
    };
    rendre();
    $("#r-q").addEventListener("input", (e) => { filtre = e.target.value; limite = 200; noterParam("q", filtre.trim()); rendre(); });
  }

  // ------------------------------------------------------------------------ faveur
  /* Page « Faveur de marchand » (25/11/2026, demande d'Emmanuel du 24/11 : préciser sur le site les patrons et les objets
     qui s'obtiennent en Faveur de marchand). data/faveur.json : les plans des marchands à Faveur avec leur coût, son
     équivalent en or au cours du point, la lecture de marché de la recette (celle de l'artisanat, sans second calcul) et le
     délai de remboursement du plan ; les certifications ; les autres monnaies. Les plans d'abord, groupés par métier. */
  const RAISONS_FAV = { jamais_vu: "produit jamais vu à cet hôtel des ventes", sans_vente: "aucune vente du produit en 7 jours", composant: "composant sans prix" };
  const ETATS_FAV = [["", "Tous"], ["chiffres", "Chiffrés"], ["rentables", "Rentables"]];
  async function vueFaveur(p, vivant) {
    const vue = $("#vue");
    titre("Faveur de marchand");
    vue.innerHTML = '<div class="titre-page"><h1>Ce que la Faveur de marchand achète</h1></div><p class="attente">Chargement…</p>';
    const doc = await charger("data/faveur.json");
    if (!vivant()) return;
    const R = doc.resume || {}, cours = doc.cours && nb(doc.cours.par_point) ? doc.cours : null, M = doc.marchands || {};
    const rangDe = (r) => r.etat === "rentable" || r.etat === "perte" ? 0 : r.etat === "enchantement" ? 3 : r.raison === "jamais_vu" ? 2 : 1;
    const L = tab(doc.colonnes, doc.plans).map((r) => ({ ...r, metier: String(r.metier), chiffre: r.etat === "rentable" || r.etat === "perte", rang: rangDe(r),
      titre: r.produit_nom || r.nom || "plan " + r.plan, k: norm(r.nom) + " | " + norm(r.produit_nom) }));
    /* Marchands : zone en français quand elle est connue, camp servi, grisé quand il ne sert pas le camp du lecteur. */
    const zoneM = (m) => (m.zones && m.zones.length ? m.zones : [m.zone]).filter(Boolean).map((z) => ZONES_FR[z] || z).join(" ou ");
    const campM = (m) => { const s = sertCamp(m.a, m.h); return s.a && s.h ? "" : s.a ? "Alliance" : s.h ? "Horde" : "hostile par défaut aux deux camps"; };
    const horsM = (id) => { const m = M[id]; if (!m) return false; const s = sertCamp(m.a, m.h); return (s.a || s.h) && pasPourMoi(m.a, m.h); };
    const marchandTxt = (id) => { const m = M[id]; if (!m) return esc("marchand " + id); const h = horsM(id);
      return `<span class="fv-m${h ? " hors" : ""}"${h ? ' title="Ce marchand ne sert pas votre camp (réglage « Mon camp »)"' : ""}>${lienExt(WHN(id), m.nom || "marchand " + id)} <span class="nd">(${esc([zoneM(m), campM(m)].filter(Boolean).join(", "))})</span></span>`; };
    const marchandsTxt = (ids) => [...(ids || [])].sort((a, b) => horsM(a) - horsM(b)).map(marchandTxt).join(" · ");
    const metiers = Object.entries(D.meta.metiers || {}).map(([k, v]) => [k, v.fr]).filter(([k]) => L.some((x) => x.metier === k)).sort((a, b) => a[1].localeCompare(b[1], "fr"));
    const presents = new Set(L.map((x) => x.metier)), cm = choixMetier(p.get("metier") || "", presents), S = cm.ids;
    const gardeM = (m) => !S.length || S.includes(String(m));
    const memeChoix = (a, b) => a.length === b.length && a.every((m) => b.includes(m));
    const versHash = (ids) => { const t = [...ids].sort((a, b) => a - b); return !t.length ? (cm.mes.length ? "tous" : "") : memeChoix(t, cm.mes) ? "" : t.join("-"); };
    const TR = [["gain", "Gain par jour d'un vendeur"], ["jours", "Plan remboursé le plus vite"], ["faveur", "Coût en Faveur"], ["nom", "Nom"]];
    const tri = TR.some(([k]) => k === p.get("tri")) ? p.get("tri") : "gain";
    const etat = ETATS_FAV.some(([k]) => k === p.get("etat")) ? p.get("etat") : "";
    const ensemble = p.get("vue") === "ensemble";
    const pp = cours ? cours.par_point : null, nMarchands = R.marchands || 0;
    const releve = doc.releve ? new Date(doc.releve).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
    const tuile = (l, v, d) => `<div class="cle-t"><div class="l">${l}</div><div class="v">${v}</div><div class="d"><span>${d}</span></div></div>`;
    const certifs = tab(doc.colonnes_certification, doc.certifications);
    const duCamp = (L.length ? L[0].marchands : []).length;
    vue.innerHTML = `
      <div class="titre-page"><h1>Ce que la Faveur de marchand achète</h1>${aide("faveur")}<p class="sous">${fmtN(R.plans)} plans et ${fmtN(R.certifications)} certifications chez ${fmtN(nMarchands)} marchands${releve ? `, relevé de Wowhead Forever du ${esc(releve)}` : ""}</p></div>
      <p class="fv-intro">La Faveur de marchand est la monnaie des caisses détournées : remplir une caisse et la remettre rapporte de la Faveur. ${fmtN(nMarchands)} marchands la prennent, ${duCamp === 2 ? "un par métier dans chaque camp, " : ""}aux Tarides pour la Horde et aux Carmines pour l'Alliance, et vendent la même chose des deux côtés.</p>
      <div class="tuiles">
        ${tuile(`Cours du point de Faveur ${aide("faveur")}`, cours ? pieces(pp) : '<span class="nd">non chiffré</span>', cours ? `remise la moins chère au relevé du ${esc(cours.photo || "jour")} : <a href="#/objet/${esc(cours.caisse)}">${esc(cours.caisse_nom || "caisse " + cours.caisse)}</a>, ${esc(prixTexte(cours.remise))} pour ${fmtN(cours.points)} points` : "aucune caisse chiffrée au dernier relevé : pas d'équivalence en or")}
        ${tuile("Plans", fmtN(R.plans), `${fmtN(R.avec_produit)} donnent un objet à vendre, ${fmtN(R.enchantements)} sont des enchantements appliqués`)}
        ${tuile("Rentables aujourd'hui", fmtN(R.rentables), `sur ${fmtN((R.rentables || 0) + (R.perte || 0))} recettes chiffrées ; ${fmtN(R.jamais_vus)} produits jamais vus à cet hôtel des ventes`)}
        ${tuile("Certifications de métier", fmtN(R.certifications), certifs.length ? `<a href="#fv-certifs" data-ancre="fv-certifs">${fmtN(certifs[0].faveur)} Faveur chacune</a>${nb(certifs[0].or) ? `, soit environ ${esc(prixTexte(certifs[0].or))}` : ""}` : "")}
      </div>
      <div class="barre">
        <label class="champ"><span>Tri</span><select id="f-tri">${TR.map(([k, v]) => `<option value="${k}"${k === tri ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="champ large"><span>Filtrer</span><input type="search" id="f-q" value="${esc(p.get("q") || "")}" placeholder="plan ou produit"></label>
        <span class="compte" id="f-compte" role="status"></span>
      </div>
      <div class="barre">
        <div class="puces serre" role="group" aria-label="Métiers"><span class="puces-l">Métier</span>
          ${metiers.map(([k, v]) => `<button type="button" class="puce" data-fm="${esc(k)}" aria-pressed="${S.includes(k)}">${esc(v)} <span class="puce-n">${fmtN(L.filter((x) => x.metier === k).length)}</span></button>`).join("")}
          <button type="button" class="puce" id="f-tous" aria-pressed="${!S.length}">tous les métiers</button>
          ${cm.mes.length && !(S.length && memeChoix(S, cm.mes)) ? `<button type="button" class="puce" id="f-mes" title="Revenir à vos métiers mémorisés (réglage « Mes métiers »)">mes métiers</button>` : ""}</div>
      </div>
      <div class="barre">
        <div class="puces serre" role="group" aria-label="État des recettes" id="f-etats"></div>
        <div class="puces serre" role="group" aria-label="Regroupement"><span class="puces-l">Liste</span>
          <button type="button" class="puce" data-fvue="" aria-pressed="${!ensemble}">par métier</button><button type="button" class="puce" data-fvue="ensemble" aria-pressed="${ensemble}">classement d'ensemble</button></div>
        <div class="puces serre" role="group" aria-label="Marchands accessibles à"><span class="puces-l">Mon camp ${aide("camp")}</span>
          ${[["horde", "Horde"], ["alliance", "Alliance"], ["tous", "les deux"]].map(([k, v]) => `<button type="button" class="puce" data-camp="${k}" aria-pressed="${k === monCamp}">${v}</button>`).join("")}</div>
      </div>
      <div id="f-corps"></div>
      <section class="appr fv-certifs" id="fv-certifs" aria-label="Certifications de métier"><h2>Certifications de métier</h2><ul class="appr-l">${certifs.map((c) => `<li><span class="appr-t">${esc(c.metier != null ? metierFr(c.metier) : "")}</span><span>${lienExt(WH(c.objet), c.nom)}, <b>${fmtN(c.faveur)}</b>${NBSP}Faveur${nb(c.or) ? ` <span class="nd">(soit environ ${esc(prixTexte(c.or))})</span>` : ""}, chez ${marchandsTxt(c.marchands)}.</span></li>`).join("")}</ul>
        <p class="petit">Jamais vues à cet hôtel des ventes. Ni l'export SkillUp ni le relevé de Wowhead Forever ne disent à quoi elles servent : usage à vérifier en jeu. Aucune pour la Cuisine.</p></section>
      <div class="g-tete fv-tete"><h2>Les autres monnaies</h2><span class="fv-n">ce que d'autres marchands vendent hors pièces</span></div>
      <div id="f-autres"></div>`;
    $("#f-tri").addEventListener("change", (e) => majHash({ tri: e.target.value === "gain" ? "" : e.target.value }));
    D.surTri = (t) => majHash({ tri: t === "gain" ? "" : t });
    vue.querySelectorAll("[data-fm]").forEach((b) => b.addEventListener("click", () => { const s = new Set(S); if (s.has(b.dataset.fm)) s.delete(b.dataset.fm); else s.add(b.dataset.fm); majHash({ metier: versHash(s) }); }));
    $("#f-tous").addEventListener("click", () => majHash({ metier: cm.mes.length ? "tous" : "" }));
    if ($("#f-mes")) $("#f-mes").addEventListener("click", () => majHash({ metier: "" }));
    vue.querySelectorAll("[data-fvue]").forEach((b) => b.addEventListener("click", () => majHash({ vue: b.dataset.fvue })));
    vue.querySelectorAll("[data-camp]").forEach((b) => b.addEventListener("click", () => { monCamp = b.dataset.camp; noterCamp(); router(); }));
    vue.querySelectorAll("[data-ancre]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); const el = document.getElementById(a.dataset.ancre); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    /* Puces d'état : comptes de la sélection de métiers, avant le filtre de texte. */
    const duMetier = L.filter((x) => gardeM(x.metier));
    const gardeE = (x, e) => e === "" || (e === "chiffres" ? x.chiffre : x.etat === "rentable");
    $("#f-etats").innerHTML = ETATS_FAV.map(([k, v]) => `<button type="button" class="puce" data-fetat="${k}" aria-pressed="${k === etat}">${v} <span class="puce-n">${fmtN(duMetier.filter((x) => gardeE(x, k)).length)}</span></button>`).join("");
    $("#f-etats").querySelectorAll("[data-fetat]").forEach((b) => b.addEventListener("click", () => majHash({ etat: b.dataset.fetat })));
    /* Tri : à gain égal ou absent, les recettes chiffrées d'abord, puis les non chiffrables, les produits jamais vus, les enchantements. */
    const parNom = (a, b) => a.titre.localeCompare(b.titre, "fr");
    const parGain = (a, b) => (a.rang - b.rang) || ((b.gain_j || 0) - (a.gain_j || 0)) || (a.faveur - b.faveur) || parNom(a, b);
    const cmp = { gain: parGain, faveur: (a, b) => (a.faveur - b.faveur) || parGain(a, b),
      jours: (a, b) => ((a.jours ?? Infinity) - (b.jours ?? Infinity)) || parGain(a, b), nom: parNom }[tri];
    const remb = (j) => j < 1 ? "plan remboursé en moins d'un jour" : `plan remboursé en ${fmtN(j, j < 10 ? 1 : 0)}${NBSP}jour${j >= 2 ? "s" : ""}`;
    const cols = entetes([{ t: "Plan" }, { t: "Coût du plan", num: true, tri: "faveur" }, { t: "Marge nette", num: true }, { t: "Demande" }, { t: "Gain par jour", num: true, tri: "gain" }], tri);
    const ligne = (x) => {
      const pr = x.produit != null ? D.parId.get(x.produit) : null, lien = x.produit != null && x.spell != null ? `#/recette/${x.spell}` : null;
      const nomH = lien ? `<a class="nom ${qcl(pr && pr.qual)}" href="${lien}">${esc(x.titre)}</a>` : `<a class="nom" href="${WH(x.plan)}" target="_blank" rel="noopener">${esc(x.titre)}${NBSP}↗</a>`;
      const rv = x.rev, etqs = (rv && rv.plus ? `<span class="etq-v" title="Le plan lui-même se revend ici plus cher, commission déduite, que son coût en Faveur converti en or">revente${NBSP}&gt;${NBSP}coût</span>` : "")
        + (rv && x.lien !== "bop" ? '<span class="etq-f" title="Plan non lié : il s\'achète et se revend à un joueur">non lié</span>' : "") + etqRecharge(x.recharge_h ?? null);
      const sous = [x.produit_nom ? esc(x.nom) : null, esc(`${metierFr(x.metier)}${x.niveau ? " " + fmtN(x.niveau) : ""}`), x.rep ? `réputation : ${esc(repTexte(x.rep))}` : null, ensemble ? marchandsTxt(x.marchands) : null].filter(Boolean).join(" · ");
      const rev = rv ? `<span class="fv-rev">Le plan se revend ici${x.lien === "bop" ? " (Wowhead le dit lié, il est pourtant en vente)" : ""} : ${nb(rv.pl) && rv.st > 0 ? `<a href="#/objet/${x.plan}">${fmtN(rv.st)} en vente</a> à partir de ${esc(prixTexte(rv.pl))}` : `<a href="#/objet/${x.plan}">aucun en vente</a> au dernier relevé`}${nb(rv.mv7) ? `, médiane vendue 7${NBSP}j ${esc(prixTexte(rv.mv7))}, soit ${esc(prixTexte(rv.net))} net de commission` : ", aucune vente en 7 jours"}${nb(rv.vj) && rv.vj > 0 ? `, ${fmtQ(rv.vj)} vendu${rv.vj >= 2 ? "s" : ""} par jour` : ""}.</span>` : "";
      const tete = `<td class="c-objet"><div class="obj"><div><div class="nom-l">${nomH}${etqs}</div><span class="en">${sous}</span>${rev}</div></div></td>`;
      const cout = `<td class="c-a num"><b>${fmtN(x.faveur)}</b><span class="fv-u">${NBSP}Faveur</span>${nb(x.or) ? `<span class="fv-or" title="Au cours du point de Faveur du dernier relevé">≈${NBSP}${pieces(x.or)}</span>` : ""}</td>`;
      const demande = x.vendus_j > 0 ? `<div class="dem"><b>${fmtQ(x.vendus_j)}</b><span>${NBSP}par jour</span></div>` : `<span class="nd">${VIDE}</span>`;
      if (!x.chiffre) {
        const raison = x.etat === "enchantement" ? "enchantement appliqué : pas d'objet à vendre" : RAISONS_FAV[x.raison] || "non chiffrable";
        return `<tr${lien ? ` data-lien="${lien}"` : ""} class="nc">${tete}${cout}<td class="c-b"><span class="nc-r">${esc(raison)}</span></td><td class="c-c">${demande}</td><td class="c-tete num"><span class="nd">${VIDE}</span></td></tr>`;
      }
      const gain = x.recharge_h === 0 ? '<span class="nd">non chiffré</span><span class="fv-rb">durée de recharge à relever</span>'
        : `${montant(x.gain_j)}<span class="u">${NBSP}/j</span><span class="fv-rb">${x.gain_j > 0 && nb(x.jours) ? remb(x.jours) : x.gain_j > 0 ? "" : "à perte : plan jamais remboursé"}</span>`;
      /* Sur téléphone, le délai de remboursement passe sur la ligne de la marge : le nom garde sa place à côté du gain. */
      const rbm = x.recharge_h === 0 ? "" : x.gain_j > 0 && nb(x.jours) ? remb(x.jours) : x.gain_j > 0 ? "" : "plan jamais remboursé";
      return `<tr data-lien="${lien}" class="${x.marge < 0 ? "negatif" : ""}">${tete}${cout}<td class="c-b num"><span class="fv-mg" data-m="marge">${pieces(x.marge)}</span><span class="sec">par fabrication</span>${rbm ? `<span class="fv-rbm">${rbm}</span>` : ""}</td><td class="c-c">${demande}</td><td class="c-tete num">${gain}</td></tr>`;
    };
    const section = (k, xs) => {
      const ms = k ? Object.keys(M).filter((id) => String(M[id].metier) === k) : [], nr = xs.filter((x) => x.etat === "rentable").length;
      const tete = k ? `<div class="g-tete fv-tete"><h2>${esc(metierFr(k))}</h2><span class="fv-n">${fmtN(xs.length)} plan${xs.length > 1 ? "s" : ""}${nr ? `, dont ${fmtN(nr)} rentable${nr > 1 ? "s" : ""}` : ""}</span><span class="fv-ms">${marchandsTxt(ms)}</span></div>` : "";
      return `${tete}<div class="liste-cadre"><table class="liste fav">${cols}<tbody>${xs.map(ligne).join("")}</tbody></table></div>`;
    };
    let filtre = p.get("q") || "";
    const rendre = () => {
      const fq = norm(filtre.trim());
      const sel = duMetier.filter((x) => gardeE(x, etat) && (!fq || x.k.includes(fq))).sort(cmp);
      const groupes = ensemble ? (sel.length ? [[null, sel]] : []) : metiers.map(([k]) => [k, sel.filter((x) => x.metier === k)]).filter(([, xs]) => xs.length);
      $("#f-corps").innerHTML = groupes.map(([k, xs]) => section(k, xs)).join("") || '<p class="rien">Aucun plan ne correspond.</p>';
      $("#f-compte").textContent = (S.length ? (S.length > 3 ? `${fmtN(S.length)} métiers` : S.map(metierFr).sort((a, b) => a.localeCompare(b, "fr")).join(", ")) + " : " : "") + `${fmtN(sel.length)} plan${sel.length > 1 ? "s" : ""}`;
    };
    rendre();
    $("#f-q").addEventListener("input", (e) => { filtre = e.target.value; noterParam("q", filtre.trim()); rendre(); });
    /* Les autres monnaies : une carte repliée par monnaie ou objet exigé. Un objet exigé en vente ici donne un prix en or. */
    const colA = doc.colonnes_autre, nomsA = new Map();
    for (const s of doc.autres || []) for (const m of s.marchands) for (const l of tab(colA, m.lignes)) nomsA.set(l.objet, l.nom);
    $("#f-autres").innerHTML = (doc.autres || []).map((s) => {
      const monnaie = s.type === "monnaie", oc = monnaie ? null : D.parId.get(s.id), prixU = oc && oc.st > 0 && nb(oc.pl) ? oc.pl : null;
      const nomS = MONNAIES_FR[s.nom] || (oc ? oc.nom : s.nom), n = s.marchands.reduce((a, m) => a + m.lignes.length, 0);
      const lienS = monnaie ? lienExt(WHC(s.id), "la monnaie sur Wowhead") : oc ? `<a href="#/objet/${oc.id}">sa fiche à cet hôtel des ventes</a>` : lienExt(WH(s.id), "l'objet sur Wowhead");
      const ou = prixU ? `En vente ici à partir de <b>${esc(prixTexte(prixU))}</b> l'unité au dernier relevé, ${fmtN(oc.st)} en vente : le prix en or de chaque ligne est donné à ce plancher.` : oc ? "Déjà vu à cet hôtel des ventes, aucun en vente au dernier relevé." : monnaie ? "Pas de cours connu ici." : "Jamais vu à cet hôtel des ventes.";
      const ligneA = (l) => { const o = D.parId.get(l.objet);
        const nomL = l.spell != null ? `<a href="#/recette/${l.spell}">${esc(l.nom)}</a>` : o ? `<a href="#/objet/${o.id}">${esc(o.nom)}</a>` : lienExt(WH(l.objet), l.nom);
        const ech = l.note && String(l.note).startsWith("echange:") ? String(l.note).split(":") : null;
        const note = l.note === "fiche" ? ' <span class="nd">(d\'après la fiche du plan : absent de la liste du marchand)</span>' : ech ? ` <span class="nd">(ou en échange de ${fmtN(Number(ech[2]))}${NBSP}× ${esc(nomsA.get(Number(ech[1])) || "objet " + ech[1])})</span>` : "";
        return `<li><b>${fmtN(l.quantite)}</b><span>${nomL}${prixU ? ` <span class="nd">soit ${esc(prixTexte(l.quantite * prixU))}</span>` : ""}${note}</span></li>`; };
      return `<details class="carte fv-autre"><summary><b>${esc(nomS)}</b><span class="fv-n">${fmtN(n)} objet${n > 1 ? "s" : ""} chez ${esc(s.marchands.map((m) => (M[m.id] || {}).nom || "marchand " + m.id).join(", "))}</span></summary>
        <p class="petit">Voir ${lienS}. ${ou}</p>
        ${s.marchands.map((m) => `<h4>${marchandTxt(m.id)}</h4><ul class="fv-l">${tab(colA, m.lignes).map(ligneA).join("")}</ul>`).join("")}</details>`;
    }).join("") || '<p class="rien">Aucune autre monnaie relevée.</p>';
  }

  // --------------------------------------------------------------------- recherche
  function chercher(q, n = 50) {
    const fq = norm(q.trim());
    if (fq.length < 2) return [];
    const mots = fq.split(/\s+/).filter(Boolean);
    return D.index.filter((o) => mots.every((m) => o.k.includes(m))).sort((a, b) => (b.vj - a.vj) || (b.vtot - a.vtot)).slice(0, n);
  }
  function tableIndex(objets, vide) {
    return `<div class="liste-cadre"><table class="liste">${entetes(COLS_OBJETS().map((c) => ({ ...c, tri: null })))}<tbody>${objets.map((o) => ligneObjet(deIndex(o))).join("") || ligneRien(vide)}</tbody></table></div>`;
  }
  function vueRecherche(q) {
    titre("Recherche");
    const hits = chercher(q || "", 300);
    $("#vue").innerHTML = `<div class="titre-page"><h1>Recherche <small>« ${esc(q || "")} »</small></h1><p class="sous">${hits.length ? `${fmtN(hits.length)} objet${hits.length > 1 ? "s" : ""}${hits.length === 300 ? " ou plus" : ""}, chiffres des 7 derniers jours` : ""}</p></div>
      ${tableIndex(hits, (q || "").trim().length < 2 ? "Deux lettres au moins." : "Aucun objet vu à l'hôtel des ventes ne porte ce nom.")}`;
    majEpingles();
  }
  function brancherRecherche() {
    const inp = $("#q"), sug = $("#suggestions");
    let focus = -1, hits = [];
    const fermer = () => { sug.hidden = true; sug.innerHTML = ""; focus = -1; };
    const aller = (id) => { location.hash = `#/objet/${id}`; inp.value = ""; fermer(); inp.blur(); };
    const ouvrir = () => {
      hits = chercher(inp.value, 8);
      if (norm(inp.value.trim()).length < 2) { fermer(); return; }
      sug.innerHTML = hits.length ? hits.map((o, i) => `<button type="button" data-id="${o.id}"${i === focus ? ' class="focus"' : ""}><span><span class="nom ${qcl(o.qual)}">${esc(o.nom)}</span><span class="en">${esc(o.en)}</span></span><span class="petit">${pieces(o.mv7 ?? o.pl)}<span class="en">${fmtQ(o.vj)} par jour</span></span></button>`).join("")
        : '<div class="rien">Aucun objet vu à l\'hôtel des ventes ne porte ce nom.</div>';
      sug.hidden = false;
      $$("button", sug).forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); aller(b.dataset.id); }));
    };
    inp.addEventListener("input", () => { focus = -1; ouvrir(); });
    inp.addEventListener("focus", ouvrir);
    inp.addEventListener("blur", () => setTimeout(fermer, 120));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); focus = Math.min(hits.length - 1, focus + 1); ouvrir(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); focus = Math.max(-1, focus - 1); ouvrir(); }
      else if (e.key === "Escape") fermer();
    });
    $("#recherche").addEventListener("submit", (e) => {
      e.preventDefault();
      if (focus >= 0 && hits[focus]) { aller(hits[focus].id); return; }
      if (inp.value.trim().length >= 2) { location.hash = `#/recherche?q=${encodeURIComponent(inp.value.trim())}`; fermer(); inp.blur(); }
    });
  }

  // -------------------------------------------------------- mes objets, mes métiers
  function vueMesObjets() {
    titre("Mes objets");
    const metiers = Object.entries(D.meta.metiers || {}).map(([k, v]) => [k, v.fr]).sort((a, b) => a[1].localeCompare(b[1], "fr"));
    const rendre = () => {
      const xs = epingles.map((i) => D.parId.get(i)).filter(Boolean);
      $("#vue").innerHTML = `<div class="titre-page"><h1>Mes objets</h1>${aide("mes")}<p class="sous">${xs.length ? `${fmtN(xs.length)} objet${xs.length > 1 ? "s" : ""} épinglé${xs.length > 1 ? "s" : ""}, chiffres des 7 derniers jours` : ""}</p></div>
        ${tableIndex(xs, "Aucun objet épinglé. Touchez l'étoile d'un objet, dans une liste ou sur sa fiche, pour le retrouver ici.")}
        <section class="carte" style="margin-top:18px" aria-labelledby="t-metiers"><div class="carte-tete"><h2 id="t-metiers">Mes métiers</h2>${aide("metiers")}</div>
          <p class="carte-sous">Ils préremplissent le filtre de métier d'Artisanat et de Farm</p>
          <div class="puces" role="group" aria-label="Mes métiers">${metiers.map(([k, v]) => `<button type="button" class="puce" data-metier="${esc(k)}" aria-pressed="${mesMetiers.includes(k)}">${esc(v)}</button>`).join("")}</div></section>`;
      majEpingles();
    };
    rendre();
    D.rafraichir = rendre;
  }

  // ------------------------------------------------------------------------ méthode
  async function vueMethode(vivant) {
    titre("Méthode");
    const [art, farm] = await Promise.all([chargerFacultatif("data/artisanat.json"), chargerFacultatif("data/farm.json")]);
    if (!vivant()) return;
    const m = D.meta, sx = (farm && farm.seuils) || {};
    const extra = {
      artisanat: art ? `Aujourd'hui : commission de ${fmtN(100 * art.commission)} %, prix des composants du ${dateFr(art.jour)}, plafond de ${fmtN(art.plafond_jour)} pièces par jour ou ${fmtN(100 * art.part_marche)} % du marché s'il est plus grand.` : "",
      farm: farm ? `Seuils du jour : au moins ${prixTexte(sx.valeur_min ?? 300)} l'unité, ${fmtN(sx.ventes_jour_min ?? 2)} ventes par jour et ${fmtN(100 * (sx.taux_min ?? 0.2))} % de ce qui est posté qui part. Gain possible par jour : ${fmtN(farm.plafond_jour ?? 20)} pièces, ou ${fmtN(100 * (farm.part_marche ?? 0.1))} % du marché s'il est plus grand.` : "",
    };
    const sec = (cle) => { const [t, x] = AIDES[cle]; return `<section id="m-${cle}"><h2>${esc(t)}</h2><p>${esc(cle === "farm" ? FARM_BASE : x)}</p>${extra[cle] ? `<p>${esc(extra[cle])}</p>` : ""}</section>`; };
    const groupe = (t, cles) => `<h3>${t}</h3>${cles.map(sec).join("")}`;
    $("#vue").innerHTML = `<div class="titre-page"><h1>Méthode et sources</h1></div><div class="methode">
      ${groupe("Les mesures", ["ventes", "mediane", "plancher", "ecoulement", "stock", "courbe", "tendance", "soutenu"])}
      ${groupe("L'accueil", ["or", "h24", "annonces", "suivis", "monte", "manque"])}
      ${groupe("La fiche d'un objet", ["verdict", "conseil", "pv", "fourchette", "profondeur", "heures", "paliers", "recettes"])}
      ${groupe("Artisanat et farm", ["artisanat", "marge", "apprendre", "camp", "faveur", "farm"])}
      ${groupe("Vos réglages", ["mes", "metiers", "remise"])}
      ${groupe("Sources et fraîcheur", ["fraicheur"])}
      <section><h2>Sources</h2><p>Hôtel des ventes ${esc(m.hotel)} (Horde, règle Normale) de WoW Forever, d'après les photos horaires de l'API Battle.net depuis le ${esc(dateFr(m.premier_jour))} : ${fmtN(m.n_objets)} objets vus, ${fmtN(m.journees.length)} journées. Noms anglais pour ${fmtN(m.n_noms_en)} objets. Recettes et sources : SkillUp Forever${m.skillup && m.skillup.build ? ` (${esc(m.skillup.build)})` : ""}.</p>
        <p>Données régénérées le ${esc(new Date(m.genere_utc).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}. Les blocs dont la donnée n'est pas encore produite par la chaîne ne sont pas affichés.</p></section></div>`;
  }

  // ------------------------------------------------- bulles d'aide et infobulle
  const boiteAide = $("#aide"), info = $("#info");
  let aideDe = null;
  function fermerAide() { if (aideDe) aideDe.setAttribute("aria-expanded", "false"); aideDe = null; boiteAide.hidden = true; }
  function ouvrirAide(b) {
    if (aideDe === b) { fermerAide(); return; }
    fermerAide();
    const a = AIDES[b.dataset.aide]; if (!a) return;
    aideDe = b; b.setAttribute("aria-expanded", "true");
    boiteAide.textContent = "";
    const t = document.createElement("b"); t.textContent = a[0];
    const l = document.createElement("a"); l.href = "#/methode"; l.textContent = "Toute la méthode";
    boiteAide.append(t, document.createTextNode(a[1]), document.createElement("br"), l);
    boiteAide.hidden = false;
    const r = b.getBoundingClientRect(), larg = boiteAide.offsetWidth, vw = document.documentElement.clientWidth;
    boiteAide.style.left = Math.max(12, Math.min(vw - larg - 12, r.left - 14)) + window.scrollX + "px";
    boiteAide.style.top = r.bottom + 8 + window.scrollY + "px";
  }
  function montrerInfo(el) {
    let d; try { d = JSON.parse(el.dataset.bulle); } catch (e) { return; }
    info.innerHTML = `<div class="t">À ${pieces(d.p)}</div>` + rangee(null, "En vente à ce prix", fmtN(d.q)) + rangee(null, "À ce prix ou moins", fmtN(d.cumul));
    info.hidden = false;
    const r = el.getBoundingClientRect(), l = info.offsetWidth, hh = info.offsetHeight, vw = document.documentElement.clientWidth;
    info.style.left = Math.max(8, Math.min(vw - l - 8, r.right - l)) + "px";
    info.style.top = (r.top - hh - 6 < 8 ? r.bottom + 6 : r.top - hh - 6) + "px";
  }
  document.addEventListener("pointerover", (e) => { const el = e.target.closest && e.target.closest("[data-bulle]"); if (el) montrerInfo(el); else info.hidden = true; });
  document.addEventListener("focusin", (e) => { const el = e.target.closest && e.target.closest("[data-bulle]"); if (el) montrerInfo(el); else info.hidden = true; });
  window.addEventListener("scroll", () => { info.hidden = true; }, { passive: true });

  // ------------------------------------------------------------ clics délégués
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.closest) return;
    const a = t.closest(".aide");
    if (a) { e.preventDefault(); e.stopPropagation(); ouvrirAide(a); return; }
    if (!t.closest("#aide")) fermerAide();
    const ep = t.closest(".epingle");
    if (ep) { e.preventDefault(); basculerEpingle(Number(ep.dataset.id)); return; }
    const pm = t.closest(".puce[data-metier]");
    if (pm) { const k = pm.dataset.metier; mesMetiers = mesMetiers.includes(k) ? mesMetiers.filter((x) => x !== k) : [...mesMetiers, k]; boite.ecrire("hv-metiers", mesMetiers); pm.setAttribute("aria-pressed", mesMetiers.includes(k)); return; }
    const rm = t.closest(".puce[data-remise]");
    if (rm) { const k = Number(rm.dataset.remise); if (REMISES.includes(k) && k !== maRemise) { maRemise = k; boite.ecrire("hv-remise", [k]); router(); } return; }
    const tr = t.closest("th .tri");
    if (tr && D.surTri) { D.surTri(tr.dataset.tri); return; }
    const l = t.closest("[data-lien]");
    if (l && !t.closest("a, button, select, input, label")) location.hash = l.dataset.lien;
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { fermerAide(); info.hidden = true; } });

  // ----------------------------------------------------------------- fraîcheur
  /* Pastille de l'en-tête : date et âge de la dernière photo ; orange au-delà de 2 heures. */
  function majFraicheur() {
    const el = $("#fraicheur"), m = D.meta;
    if (!m || !m.photo_utc) { el.textContent = ""; return; }
    const min = Math.max(0, (Date.now() - Date.parse(m.photo_utc)) / 60000), retard = min > 120;
    const age = min < 1 ? "à l'instant" : min < 60 ? `il y a ${Math.round(min)} min` : min < 2880 ? `il y a ${Math.floor(min / 60)} h${Math.round(min % 60) ? " " + p2(Math.floor(min % 60)) : ""}` : `il y a ${Math.round(min / 1440)} j`;
    const pp = String(m.photo_paris || ""), date = pp.length >= 16 ? pp.slice(0, 5) + " " + pp.slice(11, 16) : pp;
    el.className = "photo" + (retard ? " retard" : "");
    el.title = retard ? "La dernière photo de l'hôtel des ventes a plus de 2 heures : la collecte est en retard." : "Dernière photo de l'hôtel des ventes intégrée par la collecte";
    el.innerHTML = `<i></i><span><span class="pp">photo du </span><span class="pd${retard ? " court" : ""}">${esc(date)}, </span><span class="age">${age}</span>${retard ? '<span class="rt">, <span class="si-large">collecte </span>en retard</span>' : ""}</span>`;
    if (retard && !D.verif) {
      /* avant de crier au retard sur un onglet resté ouvert : la chaîne a peut-être publié une photo plus récente */
      D.verif = setTimeout(() => { D.verif = null; }, 600000);
      fetch("data/meta.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((n) => {
        if (n && n.photo_utc && Date.parse(n.photo_utc) > Date.parse(m.photo_utc)) {
          el.className = "photo"; el.innerHTML = '<i></i><button type="button" id="recharger">Nouvelle photo, actualiser</button>';
          $("#recharger").addEventListener("click", () => location.reload());
          clearInterval(D.horloge);
        }
      }).catch(() => { /* hors ligne : la pastille reste à l'orange */ });
    }
  }

  // ------------------------------------------------------------------------ routage
  let cheminCourant = null;
  async function router() {
    const brut = location.hash.replace(/^#/, "") || "/accueil";
    const [chemin, qs] = brut.split("?"), p = new URLSearchParams(qs || ""), parts = chemin.split("/").filter(Boolean);
    const connues = ["accueil", "marche", "classement", "objet", "artisanat", "recette", "faveur", "farm", "recherche", "mes-objets", "methode"];
    const vue = connues.includes(parts[0]) ? parts[0] : "accueil";
    const groupe = { objet: "classement", recherche: "classement", recette: "artisanat", marche: "accueil" }[vue] || vue;
    $$(".nav a").forEach((a) => { const on = a.dataset.vue === groupe; a.classList.toggle("actif", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    const focusId = document.activeElement && document.activeElement.id, change = chemin !== cheminCourant;
    cheminCourant = chemin;
    D.graphiques = []; D.surTri = null; D.rafraichir = null;
    fermerAide(); info.hidden = true;
    if (change) window.scrollTo(0, 0);
    const jeton = ++D.jeton, vivant = () => jeton === D.jeton;
    try {
      if (vue === "objet") await vueObjet(Number(parts[1]), p, vivant);
      else if (vue === "classement") await vueClassement(p, vivant);
      else if (vue === "artisanat") await vueArtisanat(p, vivant);
      else if (vue === "recette") await vueRecette(Number(parts[1]), vivant);
      else if (vue === "faveur") await vueFaveur(p, vivant);
      else if (vue === "farm") await vueFarm(p, vivant);
      else if (vue === "recherche") vueRecherche(p.get("q") || "");
      else if (vue === "mes-objets") vueMesObjets();
      else if (vue === "methode") await vueMethode(vivant);
      else if (vue === "marche") vueMarche();
      else vueAccueil();
    } catch (e) {
      if (vivant()) $("#vue").innerHTML = `<div class="titre-page"><h1>Erreur</h1></div><p class="attente">${esc(e.message || e)}</p>`;
    }
    if (!vivant()) return;
    majEpingles();
    if (!change && focusId && focusId !== "q") { const el = document.getElementById(focusId); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
  }
  async function demarrer() {
    try {
      const [meta, index, courbes] = await Promise.all([charger("data/meta.json"), charger("data/objets.json"), chargerFacultatif("data/courbes.json")]);
      D.meta = meta;
      D.index = tab(index.colonnes, index.lignes).map(objetDe);
      D.parId = new Map(D.index.map((o) => [o.id, o]));
      D.courbes = courbes && Array.isArray(courbes.jours) && courbes.jours.length >= 2 && courbes.lignes && typeof courbes.lignes === "object" ? courbes : null;
    } catch (e) {
      $("#vue").innerHTML = `<div class="titre-page"><h1>Données indisponibles</h1></div><p class="attente">${esc(e.message || e)}</p>`;
      return;
    }
    majFraicheur();
    D.horloge = setInterval(majFraicheur, 60000);
    $("#pied").innerHTML = `Hôtel des ventes de la Horde, WoW Forever. Ventes estimées d'après les photos horaires de l'API Battle.net depuis le ${esc(dateFr(D.meta.premier_jour))}. <a href="#/methode">Méthode et sources</a>`;
    brancherRecherche();
    window.addEventListener("hashchange", router);
    router();
  }
  demarrer();
})();
