// Codename filter, reserved names: staff and product words nobody may pass for (tok = a whole word of the name, so "Modest" and "Supportive" are free; sub = anywhere in it), and the nine speakers of the Story
// (app.story.who.*), reserved as written with their separators ("S_H_Adow"), so that the plain words they sound like ("Shadow", "Reaper") stay free.
export default {
  tok: "admin admins administrator moderator moderators mod mods support sysop gamemaster helpdesk",
  sub: "shadoku shadokuteam shadokustaff malhagames",
  speakers: ["S H Adow", "N O Ir", "O B Scuro", "P H Obia", "Q U Yet", "T N Breux", "R E Aper", "U M Bra", "The Master"],
};
