update public.businesses
set name = 'Pizzería Hermosillo'
where name = 'Pizza Demo';

update public.calls
set transcript = replace(transcript, 'Pizza Demo', 'Pizzería Hermosillo')
where transcript ilike '%Pizza Demo%';
