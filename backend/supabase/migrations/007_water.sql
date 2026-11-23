-- Water log: manual taps (one row each) and Apple Health daily totals (one row per day, id 'apple_health:<date>')
create table if not exists water_logs (
  user_id    text not null,
  id         text not null,
  date       date not null,
  ml         integer not null,
  source     text not null,
  at         timestamptz not null,
  primary key (user_id, id)
);
create index if not exists water_logs_user_date on water_logs (user_id, date);
alter table water_logs enable row level security;
