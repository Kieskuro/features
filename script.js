
      (function(){
        const ch1 = document.querySelector('ch1');
        const ch2 = document.querySelector('ch2');
        if(!ch1 || !ch2) return;
        const icon1 = ch1.querySelector('icon');
        const icon2 = ch2.querySelector('icon');

        function switchTo(showEl, hideEl){
          showEl.classList.remove('hidden');
          hideEl.classList.add('hidden');
        }


        // initialize: show ch1, hide ch2
        ch1.classList.remove('hidden');
        ch2.classList.add('hidden');

        if(icon1) icon1.addEventListener('click', async function(e){
          e.preventDefault();
          switchTo(ch2, ch1);
          await updateCounts(ch2);
        });
        if(icon2) icon2.addEventListener('click', async function(e){
          e.preventDefault();
          switchTo(ch1, ch2);
          await updateCounts(ch1);
        });

      })();