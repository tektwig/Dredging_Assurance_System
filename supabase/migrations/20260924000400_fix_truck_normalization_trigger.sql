begin;
create or replace function public.set_normalized_registration()
returns trigger
language plpgsql
as $function$
begin
    NEW.normalized_registration :=
        public.normalize_plate_number(NEW.registration_number);
    return NEW;
end;
$function$;
commit;
