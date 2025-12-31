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
});
