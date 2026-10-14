# Afiliados do Sofa

O Sofa encaminha a compra para a loja parceira. Ele não recebe o pagamento, não vende chaves e não calcula comissão por conta própria.

## Cadastro do publicador

1. Cadastre o Sofa como canal/app e solicite aprovação em uma loja ou rede. Programas oficiais: [GOG](https://affiliate.gog.com/), [Fanatical](https://www.fanatical.com/en/affiliates), [Green Man Gaming](https://www.greenmangaming.com/affiliates/) e [Nuuvem](https://secure.nuuvem.com/lp/pt/nuuvem-coop). Detalhes de cada um em "Programas por loja".
2. Depois da aprovação, obtenha seu ID público e os links de rastreamento aprovados para cada produto. Informe que o canal é um aplicativo distribuído para Windows.
3. Copie `src-tauri/publisher.example.json` para `src-tauri/publisher.local.json`. Esse arquivo fica fora do Git e só contém IDs públicos e links, nunca chaves de API, senhas ou credenciais de pagamento.
4. Preencha `publisher_id`, `program`, os domínios exatos aprovados em `allowed_tracking_hosts` e os produtos em `offers`. Faça um novo build para distribuir sua configuração. O usuário final não pode trocar o ID pelo menu do app.

Para releases no GitHub Actions, crie a variável de repositório `SOFA_PUBLISHER_CONFIG` com o JSON público completo. O workflow passa essa variável ao build. Sem ela, o CI usa o exemplo desativado; seu arquivo local ignorado pelo Git não é enviado automaticamente. JSON inválido ou campos desconhecidos interrompem o build.

O exemplo distribuído está desativado porque ainda não há conta de afiliado aprovada. Nenhum ID ou receita foi inventado.

## Programas por loja

Status em 14/10/2026, conforme as páginas oficiais; porcentagens e prazos de cookie mudam, confira no painel antes de contar com eles.

| Loja | Programa | Como entra | Comissão publicada | Preços regionais | Status no Sofa |
| --- | --- | --- | --- | --- | --- |
| GOG | [GOG Affiliate](https://affiliate.gog.com/) | inscrição na própria GOG | não publicada na página | sim | não tem (exemplo desativado) |
| Fanatical | [Fanatical Affiliates](https://www.fanatical.com/en/affiliates) | inscrição na própria loja | não publicada na página | sim | não tem |
| Green Man Gaming | [Business Affiliate Program](https://www.greenmangaming.com/affiliates/) | inscrição como site/app ("Business"); a via "Ambassador" é só para redes sociais | até 5% por venda, 10% em bundles; a aprovação dá acesso a uma API de catálogo com mais de 7.000 jogos | sim | não tem |
| Nuuvem | [Nuuvem Co-Op](https://secure.nuuvem.com/lp/pt/nuuvem-coop) | inscrição gratuita, operada pela rede Rakuten (links, relatórios e saque ficam lá); pessoa física maior de 18 anos ou empresa, no Brasil ou fora | não publicada; a página diz que o programa está em fase final de testes | sim, em reais | não tem |
| Epic Games Store | Support-A-Creator (código de criador) | criado pela própria loja | definida pela Epic por produto | sim | não tem |
| Steam | nenhum: a Steam não tem programa de afiliados, compras nela nunca geram comissão | — | — | — | — |

Regras que valem para todas: o link vem pronto do programa (`url` em `offers`), com os domínios de rastreamento aprovados em `allowed_tracking_hosts`; o Sofa não monta parâmetros de afiliado por conta própria. GMG e Nuuvem publicam preços regionais, então as ofertas delas podem trazer `quote` em reais quando o programa fornecer o preço.

## Formato de cada link aprovado

- `id`: identificador único no catálogo do Sofa.
- `steam_app_id`: identificador do jogo na Steam para associar o produto. Não é o ID do afiliado.
- `shop`: nome da loja parceira.
- `url`: link HTTPS completo fornecido/aprovado pelo programa, com seus parâmetros de atribuição.
- `quote`: `null` se não houver preço autorizado e atualizado. Quando houver, use `amount` como string decimal, `currency` com três letras maiúsculas e `expires_at` como timestamp Unix em segundos. Preços expirados não aparecem.

Esta etapa aceita links por produto. A importação automática de feeds da rede deve ser implementada depois da escolha e aprovação do programa; não existe um parâmetro de afiliado universal para todas as lojas.

## Comparação e atribuição

Seus links próprios aparecem em uma seção de parceiros, com aviso de afiliados e sem reutilizar preços de outro vendedor. As ofertas listadas na loja do Sofa vêm de agregadores com redirecionamentos próprios e não geram comissão para o publicador; só os links desta seção contam.

Após ativar um programa, confirme a atribuição no painel da rede. Clique não equivale a venda; pedidos, aprovação da comissão, cancelamentos e pagamentos são tratados pelo programa parceiro.
