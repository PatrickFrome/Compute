update public.compute_fabric_a2_browser_supervisor_state_h205f22
set state = jsonb_set(
              jsonb_set(state,'{perception,CHATGPT}',coalesce(state#>'{perception,CHATGPT}','{}'::jsonb) - 'body_excerpt',true),
              '{perception,GLM_ZAI}',coalesce(state#>'{perception,GLM_ZAI}','{}'::jsonb) - 'body_excerpt',true
            )
where state::text like '%body_excerpt%';

update public.compute_fabric_a2_browser_supervisor_command_h205f22
set receipt = receipt #- '{result,body_excerpt}'
where receipt::text like '%body_excerpt%';
