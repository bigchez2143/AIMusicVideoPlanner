(function(root){
  'use strict';
  const categories = {camera:'Camera & staging', lighting:'Lighting', color:'Color'};
  const definitions = [
    ['continuous-reframe','camera','Continuous reframing between performers','Move attention from one performer to another and back within one uninterrupted shot. Plan shared views, the camera route and continuing performance.'],
    ['tracking','camera','Tracking shot','Travel alongside, ahead of or behind a moving subject. Coordinate the camera pace with the performer or vehicle.'],
    ['orbit','camera','Arc / orbit','Travel around the subject to change the background and reveal relationships. Describe the direction, distance and stopping view.'],
    ['push-pull','camera','Push-in / pullback','Move the camera closer for emphasis or farther away to reveal the scene. Physical travel changes perspective and depth.'],
    ['pan-tilt','camera','Pan / tilt','Turn the camera horizontally or vertically from its position to follow action or reveal another part of the scene.'],
    ['boom','camera','Boom / crane movement','Raise or lower the camera through space, moving between intimate performance and a wider view.'],
    ['foreground','camera','Foreground reveal / parallax','Travel past a nearby object or performer to reveal the subject. Different movement of near and distant objects makes depth visible.'],
    ['rack-focus','camera','Rack focus','Shift sharp focus between subjects at different distances. Specify who is sharp first, who becomes sharp next and the musical cue.'],
    ['handheld','camera','Controlled handheld','Use small, purposeful operator adjustments that respond to the action while keeping faces and movement readable.'],
    ['whip-pan','camera','Whip pan','Swing rapidly toward a new subject, with brief motion blur, then land on a clear composition at a chosen musical accent.'],
    ['blocking','camera','Blocking / reblocking','Plan where each performer stands, turns and travels so the camera can transfer attention while everyone continues performing.'],
    ['background-action','camera','Layered background action','Give supporting performers meaningful activity and reactions in different depths of the scene while the featured action continues.'],
    ['musical-phrases','camera','Movement timed to musical phrases','Time camera arrivals, turns, reveals and changes of composition to a lyric, beat or section transition.'],
    ['match-action','camera','Cutting on action / match cut','For a planned edit, connect continuing movement, composition or shapes between adjacent shots. Record the matching exit and entry action.'],
    ['speed-change','camera','Planned slow motion / speed change','Change motion speed for a specific musical or emotional effect. Plan singing synchronization before production; preserve the assigned song timing.'],
    ['soft-key','lighting','Soft directional key','Use a broad source with gentle shadow edges to shape the face. Keep skin texture, eyes and the singing mouth readable.'],
    ['negative-fill','lighting','Negative fill','Reduce reflected light on the shadow side to add dimension to faces, clothing and the scene.'],
    ['rim','lighting','Backlight / rim light','Place a controlled edge of light on hair and shoulders to separate the performer from the background.'],
    ['motivated','lighting','Motivated lighting','Make illumination come from believable sources such as windows, headlights, fire, signs or stage fixtures. Keep their positions consistent.'],
    ['high-low-key','lighting','High-key / low-key balance','Choose the balance of illuminated areas and shadow: open and evenly lit, or selective pools of light with stronger contrast.'],
    ['silhouette','lighting','Silhouette','Show a recognizable outline against a brighter background for an entrance, reveal or dramatic performance moment.'],
    ['gobo','lighting','Patterned light / projection','Cast window shadows, ripples or abstract moving patterns onto performers and scenery. Specify the pattern and how it moves.'],
    ['haze','lighting','Haze / visible light beams','Use atmospheric depth to reveal light paths and separate foreground performers from distant lights and architecture.'],
    ['light-cue','lighting','Lighting cues','Change brightness, direction or color at a planned beat, lyric or camera arrival. Describe the starting light and the resulting state.'],
    ['limited-palette','color','Limited palette','Choose dominant, supporting and accent colors across lighting, wardrobe and scenery to give the scene a coherent visual world.'],
    ['complementary','color','Complementary colors','Use opposing hues for separation and contrast. Choose the pair to suit the scene rather than assuming a fixed emotional meaning.'],
    ['analogous','color','Analogous colors','Use neighboring hues for a unified look, such as amber, orange and red or blue, cyan and green.'],
    ['warm-cool','color','Warm-cool separation','Separate performers or areas using warmer and cooler light. Preserve believable skin response to the sources.'],
    ['selective-saturation','color','Selective saturation','Give important colors more intensity while keeping other colors quieter, directing attention toward a costume, prop or light.'],
    ['color-progression','color','Color progression','Change the palette deliberately as the song or story develops. Record the starting colors, transition cue and ending colors.'],
    ['shot-matching','color','Shot matching / selective grading','Keep exposure, contrast, skin and costume colors consistent across shots. Describe intentional changes and any areas that need separate adjustment.']
  ];
  const catalog = definitions.map(([key,category,title,description])=>({key,category,title,description}));
  function entry(key,id,category='camera') {
    const item = catalog.find(t=>t.key===key);
    if(!item && key!=='custom')throw Error('Choose a technique from the list.');
    if(!categories[category])throw Error('Unknown technique category.');
    return {id,techniqueId:item?.key||'custom',category:item?.category||category,title:item?.title||'Custom technique',description:item?.description||'',directions:''};
  }
  const api={categories,catalog,entry};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.SceneTechniques=api;
})(typeof globalThis!=='undefined'?globalThis:this);
