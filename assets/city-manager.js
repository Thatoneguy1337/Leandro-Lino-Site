document.addEventListener('DOMContentLoaded', () => {
  // Elementos do DOM
  const citiesDialog = document.getElementById('citiesDialog');
  const cityList = document.getElementById('cityList');
  const cityRowTpl = document.getElementById('cityRowTpl');
  const openCitiesBtn = document.getElementById('openCities');
  const closeCitiesBtn = document.getElementById('closeCities');
  const okCitiesBtn = document.getElementById('okCities');

  const confirmDeleteDialog = document.getElementById('confirmDeleteCityDialog');
  const confirmDelOkBtn = document.getElementById('confirmDelOk');
  const confirmDelCancelBtn = document.getElementById('confirmDelCancel');
  const confirmDelCityName = document.getElementById('confirmDelCityName');

  let cityToDeleteId = null;

  // API Endpoint
  const API_URL = 'api/cities.php';

  /**
   * Fetches cities from the API and renders them in the table.
   */
  async function renderCityList() {
    try {
      const response = await fetch(`${API_URL}?action=list`);
      if (!response.ok) {
        throw new Error('Failed to fetch city list.');
      }
      const result = await response.json();

      // Clear existing list
      cityList.innerHTML = '';

      if (result.ok && result.data.length > 0) {
        result.data.forEach(city => {
          const tpl = cityRowTpl.content.cloneNode(true);
          const tr = tpl.querySelector('tr');

          tr.dataset.id = city.id;
          tr.querySelector('[data-col="name"]').textContent = city.name;
          tr.querySelector('[data-col="prefix"]').textContent = city.prefix || 'N/A';
          tr.querySelector('[data-col="file"]').textContent = city.file ? city.file.name : 'Nenhum';

          cityList.appendChild(tpl);
        });
      } else {
        cityList.innerHTML = '<tr><td colspan="5" class="center muted">Nenhuma cidade cadastrada.</td></tr>';
      }
    } catch (error) {
      console.error('Error rendering city list:', error);
      cityList.innerHTML = `<tr><td colspan="5" class="center danger">Erro ao carregar cidades.</td></tr>`;
    }
  }

  /**
   * Handles clicks on action buttons in the city list.
   */
  cityList.addEventListener('click', (e) => {
    const target = e.target.closest('[data-act]');
    if (!target) return;

    const action = target.dataset.act;
    const tr = target.closest('tr');
    const cityId = tr.dataset.id;
    const cityName = tr.querySelector('[data-col="name"]').textContent;

    if (action === 'delete') {
      cityToDeleteId = cityId;
      confirmDelCityName.textContent = cityName;
      confirmDeleteDialog.showModal();
    }
    // Handle other actions like 'edit' or 'load' here if needed
  });

  /**
   * Handles the confirmation of a city deletion.
   */
  confirmDelOkBtn.addEventListener('click', async () => {
    if (!cityToDeleteId) return;

    try {
      const formData = new FormData();
      formData.append('action', 'delete');
      formData.append('id', cityToDeleteId);

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.ok) {
        // Refresh the list to show the city has been removed
        await renderCityList();
      } else {
        throw new Error(result.error || 'Failed to delete city.');
      }
    } catch (error) {
      console.error('Error deleting city:', error);
      alert(`Erro ao excluir a cidade: ${error.message}`);
    } finally {
      // Hide the confirmation dialog and reset the ID
      confirmDeleteDialog.close();
      cityToDeleteId = null;
    }
  });

  // Close the delete confirmation dialog on cancel
  confirmDelCancelBtn.addEventListener('click', () => {
    confirmDeleteDialog.close();
    cityToDeleteId = null;
  });

  // Open/Close the main cities dialog
  openCitiesBtn.addEventListener('click', () => {
    renderCityList(); // Re-render the list every time the dialog is opened
    citiesDialog.showModal();
  });

  closeCitiesBtn.addEventListener('click', () => citiesDialog.close());
  okCitiesBtn.addEventListener('click', () => citiesDialog.close());

  // =========================================================
  //  NOVO: Lógica do Formulário de Cidades (Salvar / Editar)
  // =========================================================

  const cityForm = document.getElementById('cityForm');
  const cityNameInput = document.getElementById('cityName');
  const cityPrefixInput = document.getElementById('cityPrefix');
  const cityIdInput = document.getElementById('cityId');
  const cityFileInput = document.getElementById('cityFile');
  const btnCityNew = document.getElementById('btnCityNew');
  const btnCitySave = document.getElementById('btnCitySave');
  const btnCityDelete = document.getElementById('btnCityDelete');

  // Limpar formulário para nova cidade
  btnCityNew?.addEventListener('click', () => {
    cityForm.reset();
    cityIdInput.value = '';
    btnCityDelete.style.display = 'none'; // Esconde excluir em modo novo
    cityNameInput.focus();
  });

  // Helper: Remover acentos apenas para gerar o PREFIXO
  function stripAccents(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
  }

  // Auto-gerar prefixo ao digitar o nome (se o prefixo estiver vazio ou sendo editado)
  cityNameInput?.addEventListener('input', () => {
    // O nome aceita tudo (acentos, espaços).
    // O prefixo será gerado sem acentos, maiúsculo, max 3 letras (ou mais se preferir)
    const nameVal = cityNameInput.value;

    // Gera sugestão: pega iniciais ou 3 primeiras letras
    // Lógica simples: 3 primeiras letras do nome limpo
    if (cityIdInput.value === '') { // Só auto-preenche se for novo cadastro
      const clean = stripAccents(nameVal).replace(/[^a-zA-Z]/g, '').toUpperCase();
      if (clean.length > 0) {
        cityPrefixInput.value = clean.substring(0, 3);
      } else {
        cityPrefixInput.value = '';
      }
    }
  });

  // Salvar (Submit)
  cityForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = cityNameInput.value.trim();
    if (!name) {
      alert('O nome da cidade é obrigatório.');
      return;
    }

    try {
      btnCitySave.disabled = true;
      btnCitySave.textContent = 'Salvando...';

      const formData = new FormData();
      const action = cityIdInput.value ? 'update' : 'create';
      formData.append('action', action);
      if (cityIdInput.value) formData.append('id', cityIdInput.value);

      formData.append('name', name);
      formData.append('prefix', cityPrefixInput.value.trim().toUpperCase());

      if (cityFileInput.files.length > 0) {
        formData.append('file', cityFileInput.files[0]);
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.ok) {
        // Sucesso
        alert(cityIdInput.value ? 'Cidade atualizada!' : 'Cidade criada!');
        cityForm.reset();
        cityIdInput.value = '';
        btnCityDelete.style.display = 'none';

        await renderCityList(); // Atualiza tabela
      } else {
        throw new Error(result.error || 'Erro ao salvar cidade.');
      }

    } catch (error) {
      console.error('Erro ao salvar cidade:', error);
      alert('Falha: ' + error.message);
    } finally {
      btnCitySave.disabled = false;
      btnCitySave.textContent = 'Salvar';
    }
  });

  // Botão Excluir (dentro do form) - atalho para a lógica de exclusão
  btnCityDelete?.addEventListener('click', () => {
    if (!cityIdInput.value) return;
    cityToDeleteId = cityIdInput.value;
    confirmDelCityName.textContent = cityNameInput.value;
    confirmDeleteDialog.showModal();
  });

  // Carregar dados no form ao clicar em Editar na tabela
  cityList.addEventListener('click', (e) => {
    const target = e.target.closest('[data-act="edit"]');
    if (!target) return;

    const tr = target.closest('tr');
    const id = tr.dataset.id;
    const name = tr.querySelector('[data-col="name"]').textContent;
    const prefix = tr.querySelector('[data-col="prefix"]').textContent;

    // Preenche form
    cityIdInput.value = id;
    cityNameInput.value = name;
    cityPrefixInput.value = (prefix === 'N/A') ? '' : prefix;

    btnCityDelete.style.display = 'inline-flex'; // Mostra botão excluir
    cityNameInput.focus();
  });

});
