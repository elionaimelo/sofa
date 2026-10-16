# ScreenScraper

Situação no Sofa: **não integrado**. É uma opção futura de fonte de gameplay e outros materiais; a reprodução atual usa trechos publicados pelas distribuidoras na Steam, sem cadastro adicional. A cobertura de cada título no ScreenScraper ainda precisa ser verificada.

O cadastro de usuário e o acesso do aplicativo são etapas diferentes. A [documentação oficial da API](https://www.screenscraper.fr/webapi2.php) pede `devid`, `devpassword` e `softname`, além das credenciais do usuário quando aplicáveis. Uma consulta sem identificação de desenvolvedor foi recusada na verificação de 16/10/2026. O Sofa não tem essas credenciais; não reutilizar as de outro projeto.

Para solicitar o acesso:

1. Criar uma [conta ScreenScraper](https://www.screenscraper.fr/membreinscription.php).
2. Apresentar o Sofa no [fórum indicado pela API](https://www.screenscraper.fr/forumsujets.php?frub=12&numpage=0) e solicitar as credenciais do aplicativo. Confirmar as condições para o modelo de distribuição do Sofa: a documentação prevê aplicativos inteiramente gratuitos e distribuídos, ou autorização específica da equipe.
3. Com acesso autorizado, implementar a conexão da conta, armazenamento protegido das credenciais, correspondência dos jogos, cache e respeito às quotas retornadas pela API. Nenhuma senha deve ser guardada no frontend ou em logs.

Texto sugerido para a solicitação, em inglês:

> Hello! I am developing Sofa, a controller-first Windows game launcher built with Tauri and React. I would like to integrate ScreenScraper to retrieve gameplay videos, artwork and metadata for the user's game library. Could you explain the requirements for obtaining developer credentials and authorizing Sofa's use of the API? I would also like to confirm coverage for modern Windows games and the applicable caching, quota and distribution conditions. Thank you!

Fonte sobre o comportamento do RetroBat: [Scraping & Metadata](https://github.com/RetroBat-Official/retrobat-wiki/blob/master/lang/en/navigation/scraping-and-metadata.md). Ele oferece ScreenScraper como serviço padrão e também aceita vídeos MP4 locais.
