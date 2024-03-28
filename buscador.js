import * as cheerio from "cheerio";
import path from "path";
import { readFileSync, readdirSync } from "fs";
import promptSync from "prompt-sync";
const prompt = promptSync();

// Map para armazenar páginas visitadas e para Indexadas
const visitedPages = new Map();

const indexedPages = new Map();

const configFile = "./scoreConfig.json";

// TODO: FUNÇÕES DE AUXILIO NAS OPERAÇÕES
//==========================================================================
//==========================================================================

// Limpa a url para ficar apenas o nome da página. Ex.: "mochileiro.html"
const cleanUrl = (url) => {
  return path.basename(url);
};

// Realiza a leitura de uma página HTML
const readHtml = (pageUrl) => {
  const htmlContent = readFileSync(pageUrl, "utf8");
  const $ = cheerio.load(htmlContent);
  return $;
};

// TODO: 4-A) INDEXANDO AS PÁGINAS E CALCULANDO AS PONTUAÇÕES
//============================================================================
//============================================================================

// Realiza Aa maioria dos calculos de pontuação
const crawlPage = async (url, originUrl = url, termo, values) => {
  const cleanedUrl = cleanUrl(url);

  // Verifica se o link já foi visitado
  if (visitedPages.has(cleanedUrl)) {
    return; // Se já, pula a recursão
  }

  // Marca a página como visitada
  visitedPages.set(cleanedUrl, { visites: true, autoridade: 0 });

  try {
    const links = extractLinks(url); // guarda os links em VISITED LINKS
    visitedPages.get(cleanedUrl).links = links;

    // Obtém a ocorrência dos termos buscados para a página atual
    const contentHtml = readHtml(url);

    // Realiza o calculo da Quantidade de Termos Buscados,
    const termOccurrences = await setFrequenciaTermoBuscado(termo, contentHtml);

    const totalTermFrequencyScore = calculateTermFrequencyScore(
      termOccurrences,
      values
    );
    const totalTagScore = setTotalTagScore(termOccurrences, values);
    const totalSelfReferencePenalty = setSelfReferences(
      contentHtml,
      values,
      cleanedUrl
    );

    const totalContentFreshnessScore = calculateContentFreshness(
      contentHtml,
      values
    );
    // Adiciona as pontuações à página atual no indexedPages

    indexedPages.set(cleanedUrl, {
      autoridade: 0,
      frequenciaDoTermo: totalTermFrequencyScore,
      scorePerTag: totalTagScore,
      penalidadeAutoReferencia: totalSelfReferencePenalty,
      frescorConteudo: totalContentFreshnessScore,
    });
    // 4. c) Para cada link, baixa a página referenciada recursivamente
    for (const link of links) {
      if (!visitedPages.has(cleanUrl(link))) {
        await crawlPage(`./páginas/${link}`, originUrl, termo, values);
      }
    }
  } catch (err) {
    console.error(`Erro ao rastrear ${url}`);
  }
};

// EXTRAI TODOS OS LINKS DE UMA PÁGINA E RETORNA ELES
const extractLinks = (url) => {
  const htmlContent = readFileSync(url, "utf8"); // Certifique-se de especificar o encoding como "utf8"
  // Carrega o conteúdo HTML no Cheerio
  const $ = cheerio.load(htmlContent);

  const links = [];

  // Seleciona todos os elementos <a> e extrai os links
  $("a").each(function () {
    const href = $(this).attr("href");
    links.push(href);
  });

  return links;
};

const setAuthority = (scores) => {
  let authorityValue = scores.autoridade;
  let occurrences = 0;
  for (let [key1, value1] of visitedPages.entries()) {
    for (let [key2, value2] of visitedPages.entries()) {
      occurrences += countOccurrences(value2.links, key1);
    }
    // definindo a autoridade
    indexedPages.get(key1).autoridade += occurrences * authorityValue;
    occurrences = 0;
  }
};

const countOccurrences = (array, searchValue) => {
  let count = 0;
  for (const value of array) {
    if (value === searchValue) {
      count++;
    }
  }
  return count;
};

// TODO: 2-A) DEFININDO AUTORIDADE DAS PÁGINAS
//============================================================================
//============================================================================

// COLOCANDO O VALOR DA AUTORIADE
const iterateOnPages = async (pages, scores, termo) => {
  // Limpa o visitedPages antes de começar a iterar sobre as páginas
  visitedPages.clear();

  // Percorre cada uma das páginas
  for (let i = 0; i < pages.length; i++) {
    await crawlPage(`./páginas/${pages[i]}`, pages[i], termo, scores);
  }
};

// TODO: 2-B) OCORRÊNCIA DOS TERMOS BUSCADOS & VALOR POR TAG
//============================================================================
//============================================================================
const getOcorrences = (termo, text) => {
  const termRegex = new RegExp(`(^|\\s|")(${termo})(\\b|")`, "gi");
  const matches = text.toLowerCase().match(termRegex) || [];
  return matches.length;
};

// DEFINE A FREQUENCIA QUE O TERMO APARECE EM UMA PAGINA
// Vai pegando o conteudo dentro das tags (a, p, h1...) e retorna o numero de ocorrencias do termo em cada tag
const setFrequenciaTermoBuscado = async (termo, page) => {
  // Guarda a quantidade de ocorrências em cada tag
  let ocorrences = {
    meta: 0,
    title: 0,
    h1: 0,
    h2: 0,
    p: 0,
    a: 0,
  };

  // seletores que serão ranqueados
  const selectors = ["p", "h1", "h2", "a", "meta", "title"];

  // DEFININDO A QUANTIDADE DE OCORRENCIA DO TERMO
  for (const selector of selectors) {
    let selectorText = "";

    if (selector == "meta") {
      const metaValues = [];
      let i = 0;

      // pega os valores da tag <meta>
      page(selector).each((index, element) => {
        if (page(element).attr("name") != undefined) {
          metaValues[i++] = page(element).attr("name");
        }
      });

      // realiza o calculo de ocorrencia dentro de cada valor de <meta>
      // ou seja, entrando em "descripton","keywords","author"...
      for (let i = 0; i < metaValues.length; i++) {
        let metaContent = page(`meta[name=${metaValues[i]}]`).attr("content");
        selectorText += metaContent.trim().toLowerCase() + " ";
      }
    } else {
      page(selector).each((index, element) => {
        selectorText += page(element).text().trim().toLowerCase() + " ";
      });
    }
    // guarda o número de ocorrencias da tag
    ocorrences[selector] = getOcorrences(termo, selectorText);
  }

  return ocorrences;
};

//TODO: SOMA TOTAL DA FREQUENCIA DOS TERMOS
const calculateTermFrequencyScore = (ocorrences, values) => {
  const scorePerOccurrence = values.valorPorOcorrencia;
  let sumFrequency = 0;

  // Percorrendo objeto de ocorrencias para somar o resultado total
  Object.keys(ocorrences).forEach((key) => {
    sumFrequency += ocorrences[key] * scorePerOccurrence;
  });

  return sumFrequency;
};

// TODO: 2-C) PONTUAÇÃO POR OCORRENCIA DAS TAGS
//============================================================================
//============================================================================
const setTotalTagScore = (ocorrences, values) => {
  const scorePerTag = values.valorPorTag;
  let totalTagScore = 0;

  Object.keys(ocorrences).forEach((key) => {
    const pontuacao = scorePerTag[key];
    const quantidade = ocorrences[key];
    totalTagScore += quantidade * pontuacao;
  });

  return totalTagScore;
};

// TODO: 2-D) Penalização por autoreferencia
const setSelfReferences = (page, scores, url) => {
  let penaltyPerReference = scores.penalidadeAuto;
  const initialPoints = 0;

  const selfReferences = [];

  // Extrai o nome do arquivo do caminho do arquivo, desconsiderando a extensão html
  const fileNameWithoutExtension = url;

  // Percorre os links
  page("a").each(function (i, link) {
    // Verifica se o href do link contém o nome do arquivo sem a extensão
    if (page(link).attr("href").includes(fileNameWithoutExtension)) {
      selfReferences.push(page(link).attr("href"));
    }
  });

  // Calcula a penalidade total com base no número de autoreferências encontradas
  const totalPenalty = selfReferences.length * penaltyPerReference;

  // Atualiza os pontos iniciais com a penalidade
  const updatedPoints = initialPoints + totalPenalty;

  return updatedPoints; // Retorna os pontos atualizados
};

// TODO: 2-E) FRESCOR DE CONTEUDO

// calculando frescor do conteudo
function calculateContentFreshness(page, scores) {
  // calculando frescor do conteudo
  let score = 30; // inicializa o score com 30
  const penalty = 5; // determina a penalidade como 5 a cada ano de diferença

  // Tenta encontrar a data de publicação no elemento <p>
  const publicationDateElement = page("p").filter(
    (i, el) =>
      page(el).text().includes("Data da Publicação:") ||
      page(el).text().includes("Data de postagem:")
  );

  let publicationDate = "";
  if (publicationDateElement.length > 0) {
    publicationDate = publicationDateElement.text(); //obter o conteúdo de texto de um elemento HTML
  } else {
    return 0;
  }

  const currentYear = new Date().getFullYear();
  const dateParts = publicationDate.split(":")[1].trim().split("/");
  const year = parseInt(dateParts[2], 10);

  let totalPenalty = 0;

  if (year != currentYear) {
    totalPenalty = (currentYear - year) * penalty;
  }

  score -= totalPenalty; // decrementa o score conforme a penalidade

  return score;
}

// TODO: 5) LENDO ARQUIVO DE CONFIGURAÇÃO
const readScoreValues = (filePath) => {
  const values = JSON.parse(readFileSync(filePath, "utf-8"));
  return values.scoreConfig;
};

// lê as páginas da pasta
const getPages = (folder) => {
  const fileNames = readdirSync(folder);
  return fileNames;
};

// Função para ranquear as paginas
// Função para classificar as páginas
const rankPages = async (pages, termo, scores) => {
  await iterateOnPages(pages, scores, termo);
  setAuthority(scores);

  // Calcula o score total de cada página.
  indexedPages.forEach((pageData, pageUrl) => {
    const totalScore = calculateTotalScore(pageData);
    indexedPages.set(pageUrl, { ...pageData, totalScore });
  });

  // Converte o "Map" para Array para melhor organização
  const pagesArray = Array.from(indexedPages.entries());

  // Organiza pelo score total e em ordem descendente
  pagesArray.sort((a, b) => b[1].totalScore - a[1].totalScore);

  // Aplica a função de desempate
  for (let i = 0; i < pagesArray.length - 1; i++) {
    for (let j = i + 1; j < pagesArray.length; j++) {
      if (pagesArray[i][1].totalScore === pagesArray[j][1].totalScore) {
        const result = tiebreak(pagesArray[i][1], pagesArray[j][1]);
        if (result === 1) {
          // Troca as páginas de lugar caso o score de 'i' for maior que o score de 'j'
          [pagesArray[i], pagesArray[j]] = [pagesArray[j], pagesArray[i]];
        }
      }
    }
  }

  // Converte denovo o Array para Map para melhor consistencia com o resto do código
  const rankedPages = new Map(pagesArray);

  return rankedPages;
};

//Função para calcular o score total
function calculateTotalScore(pageData) {
  const {
    autoridade,
    frequenciaDoTermo,
    scorePerTag,
    penalidadeAutoReferencia,
    frescorConteudo,
  } = pageData;

  // Calcula o score total somando tudo
  const totalScore =
    autoridade +
    frequenciaDoTermo +
    scorePerTag +
    penalidadeAutoReferencia +
    frescorConteudo;

  return totalScore;
}
//Função para desempate
function tiebreak(page1, page2) {
  // a. Frequencia do termo
  if (page1.frequenciaDoTermo !== page2.frequenciaDoTermo) {
    return page1.frequenciaDoTermo > page2.frequenciaDoTermo ? 1 : -1;
  }

  // b. Maior frescor do conteúdo
  if (page1.frescorConteudo !== page2.frescorConteudo) {
    return page1.frescorConteudo > page2.frescorConteudo ? 1 : -1;
  }

  // c. Maior quantidade obtida de links
  if (page1.autoridade !== page2.autoridade) {
    return page1.autoridade > page2.autoridade ? 1 : -1;
  }

  // Se todos os criterios forem iguais, retorna 0.
  return 0;
}

(async () => {
  const pages = getPages("./páginas");
  const scoreValues = readScoreValues(configFile);
  const searchTerm = prompt("Digite o termo que deseja pesquisar: ");
  const rankedPages = await rankPages(pages, searchTerm, scoreValues);
  console.log("Resultado da busca: ");
  // Converter "MAP" para Array e incluir o "Deve ser exibida"
  const mostrarResultadosArray = Array.from(
    rankedPages,
    ([pageUrl, pageData]) => ({
      Pagina: pageUrl,
      Autoridade: pageData.autoridade,
      "Frequencia do termo": pageData.frequenciaDoTermo,
      "Uso em tags": pageData.scorePerTag,
      AutoReferência: pageData.penalidadeAutoReferencia,
      "Frescor do conteúdo": pageData.frescorConteudo,
      Total: pageData.totalScore,
      "Deve ser exibida": pageData.frequenciaDoTermo > 0 ? "Sim" : "Não",
    })
  );

  // Filtrar paginas que devem ser exibidas e remover o ".html" do nome das páginas
  const paginasResultado = mostrarResultadosArray
    .filter((page) => page["Deve ser exibida"] === "Sim")
    .map((page) => page.Pagina.replace(/\.html$/, ""));

  // Mostrar as páginas de resultado
  console.log(paginasResultado);

  // Pergunta se o usuário quer ver os detalhes
  const showDetails = prompt("Quer ver os detalhes? (sim/nao) ");

  if (showDetails.toLowerCase() === "sim") {
    mostrarDetalhes(mostrarResultadosArray);
  }

  // Function to display the detailed table
  function mostrarDetalhes() {
    console.table(mostrarResultadosArray);
  }
})();
