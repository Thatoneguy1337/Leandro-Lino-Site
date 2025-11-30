# GeoViewer Pro

O GeoViewer Pro é uma aplicação web interativa projetada para visualização e gerenciamento de dados geográficos, especificamente arquivos KMZ/KML. Ele oferece ferramentas avançadas para carregar, exibir e interagir com informações geoespaciais, otimizando o desempenho para grandes volumes de dados.

## Funcionalidades Principais

*   **Visualização de Mapas:** Exibe dados geográficos (linhas, marcadores e polígonos) extraídos de arquivos KMZ/KML em um mapa interativo, utilizando a biblioteca Leaflet.
*   **Upload de Arquivos KMZ/KML:** Permite o upload fácil de arquivos KMZ/KML através de arrastar e soltar (drag-and-drop) ou seleção de arquivo, com processamento otimizado para extração de geometrias.
*   **Gerenciamento de Camadas:** Oferece um painel para visualizar e controlar a visibilidade de diferentes camadas (alimentadores, grupos de postos), incluindo a exibição de cores associadas a cada camada.
*   **Sistema de Cache Robusto:** Utiliza IndexedDB para armazenar dados de mapa processados e LocalStorage para o estado da sessão. Isso garante carregamento rápido e eficiente do mapa em visitas subsequentes, mesmo para arquivos KMZ muito grandes.
*   **Restauração de Sessão:** Restaura automaticamente a última visualização do mapa (centro e zoom) e o estado de visibilidade das camadas ao recarregar a página.
*   **Geolocalização:** Funcionalidade para localizar a posição atual do usuário no mapa.
*   **Pesquisa:** Permite buscar por pontos e grupos locais no mapa, além de geocodificação remota para encontrar locais.
*   **Uploads Recentes:** Exibe uma lista dos arquivos carregados recentemente, tanto do servidor quanto do cache local, facilitando o acesso rápido.
*   **Nível de Detalhe (LOD) Dinâmico:** Otimiza a renderização de linhas e marcadores ajustando o nível de detalhe automaticamente conforme o nível de zoom do mapa, melhorando o desempenho visual.

## Como Rodar a Aplicação

Esta aplicação utiliza PHP para servir os arquivos estáticos e lidar com as requisições da API.

### Pré-requisitos

*   **Servidor PHP:** Você precisará de uma instalação do PHP (versão 7.4 ou superior é recomendada).
*   **XAMPP (Recomendado):** Para uma configuração fácil de um ambiente de desenvolvimento web (Apache, MySQL, PHP, Perl) no Windows, macOS ou Linux, o XAMPP é altamente recomendado. Ele instala e configura o PHP para você.
    *   [Baixar XAMPP](https://www.apachefriends.org/index.html)

### Passos para Executar

1.  **Instale o XAMPP (se ainda não o fez):** Siga as instruções de instalação para o seu sistema operacional.
2.  **Coloque os arquivos do projeto:**
    *   Se estiver usando o XAMPP, copie todo o conteúdo da pasta da aplicação (onde está este `README.md`, `index.html`, `api/`, etc.) para o diretório `htdocs` do XAMPP (por exemplo, `C:\xampp\htdocs\seunome_site` ou `/Applications/XAMPP/htdocs/seunome_site`).
3.  **Inicie o servidor PHP:**
    *   **Com XAMPP:** Inicie o módulo Apache através do painel de controle do XAMPP. Os arquivos já estarão sendo servidos.
    *   **Sem XAMPP (usando o servidor embutido do PHP):**
        *   Navegue até a pasta raiz do seu projeto (onde está o `index.html`) no terminal.
        *   Execute o seguinte comando:
            ```bash
            php -S localhost:8000
            ```
            Este comando iniciará um servidor web local na porta `8000`.
4.  **Acesse a Aplicação:**
    *   Abra seu navegador web e digite: `http://localhost:8000` (se usou o servidor embutido do PHP).
    *   Se estiver usando o XAMPP e colocou os arquivos em um subdiretório, o endereço será algo como: `http://localhost/seunome_site` (substitua `seunome_site` pelo nome da sua pasta).

A aplicação estará agora acessível no seu navegador.