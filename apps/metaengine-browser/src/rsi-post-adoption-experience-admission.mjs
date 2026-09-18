import crypto from 'node:crypto';
import { verifyRsiPostAdoptionCausalMeasurement } from './rsi-post-adoption-causal-measurement.mjs';
import { verifyRsiEpisodePromotionReview } from './rsi-episode-promotion-review.mjs';
import { createRsiExperienceCase, createRsiExperienceGraphSnapshot, extendRsiExperienceGraphSnapshot } from './rsi-experience-graph.mjs';

export const RSI_POST_ADOPTION_EXPERIENCE_ADMISSION_SCHEMA='metaengine.rsi.post-adoption-experience-admission.v1';

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}

export function rsiPostAdoptionExperienceAdmissionTrustRootSnapshot(){
  const root={schema:'metaengine.rsi.post-adoption-experience-admission-root.v1',version:1,
    adapter_path:'apps/metaengine-browser/src/rsi-post-adoption-experience-admission.mjs',
    existing_experience_graph_only:true,append_only_graph_admission:true,
    direct_execution_enabled:false,direct_promotion_enabled:false,direct_self_update_enabled:false,authority_effect:false};
  return Object.freeze({...root,root_digest:digest(root)});
}
