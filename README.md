# Hambúrguer PIBG

## Supabase

Projeto: `hcehptespejazgapynus` — [abrir painel](https://supabase.com/dashboard/project/hcehptespejazgapynus).

O banco guarda a venda ativa, reservas, pedidos confirmados, retirada e etapas da cozinha. A venda inicial começa com 150 combos de R$ 25,00.

## Novo domingo, novo link

Quando o domingo terminar, use **Encerrar domingo atual** no painel. Só depois disso o formulário **Novo domingo** aparece. Ao criar o novo domingo, o sistema:

1. Cria uma venda nova, com estoque e pedidos próprios.
2. Mostra um link e QR Code novos para enviar no grupo e colocar na igreja.

Enquanto houver domingo ativo, o banco bloqueia a criação de outro. Ao encerrar, reservas que não foram pagas expiram, o link anterior mostra “Venda encerrada” e a recepção/cozinha param de exibir aquela venda.

## Criar os acessos privados

No painel do Supabase, abra **Authentication > Users > Add user** e crie uma única conta compartilhada, por exemplo `equipe@pibg.com`. Ela será usada pelos voluntários na recepção, cozinha e para abrir cada novo domingo.

Depois, abra **SQL Editor**, troque o e-mail e execute:

```sql
insert into public.team_members (user_id, role)
select id, 'admin'
from auth.users
where email = 'equipe@pibg.com'
on conflict (user_id) do update set role = excluded.role;
```

Quem entra com essa conta compartilhada pode registrar venda presencial, ler o QR Code para entregar pedidos, abrir a cozinha, alterar a quantidade de combos e criar o próximo domingo.

Em produção, a câmera do celular exige que o site esteja em HTTPS; Vercel já entrega isso automaticamente no domínio público.

## Segurança de publicação

O site conectado ao Supabase ainda usa confirmação de Pix simulada. Não publique esta integração como venda aberta antes de instalar o webhook do Mercado Pago; do contrário, alguém poderia confirmar uma reserva sem pagar.

A chave presente em `supabase-client.js` é pública por design. Senhas, chave `service_role`, token do Mercado Pago e senha do banco não devem ser colocados no site nem enviados ao Git.
